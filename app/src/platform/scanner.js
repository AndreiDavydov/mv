import { jsQR } from '../../../vendor/jsqr.js';

/**
 * Continuous QR decoding from a live camera.
 *
 * `BarcodeDetector` is used where the platform has it (Chrome/Android) because
 * it decodes on the GPU and costs almost nothing; jsQR is the fallback for
 * Safari/iOS. Feature-detected, never user-agent sniffed.
 */

const SAMPLE_EDGE = 480; // what the decoder actually gets, per side

/**
 * How much wider than the reticle to actually decode.
 *
 * The box on screen is where people aim, but nobody aims exactly, and a label
 * a few millimetres outside it should still be read rather than silently
 * ignored. A third again is generous enough to be forgiving and tight enough
 * to keep the resolution the crop exists for.
 */
const REGION_SLACK = 1.35;

/** Every Nth frame, look at the whole picture instead of just the reticle. */
const WIDE_EVERY = 4;

/**
 * Milliseconds between decode attempts.
 *
 * This used to decode on every animation frame, which is sixty full decodes a
 * second — and on iOS, where there is no BarcodeDetector, each one is a canvas
 * draw, a getImageData and a complete jsQR scan. The phone got hot enough to
 * notice within a few minutes of packing, and the battery went with it.
 *
 * Ten a second is far more than enough: a hand bringing a phone to a label
 * takes a few hundred milliseconds to settle, so nothing is caught later than
 * it would have been, and the CPU spends nine tenths of its time idle.
 */
const DECODE_INTERVAL_MS = 100;

export async function detectorKind() {
  if (!globalThis.BarcodeDetector) return 'jsqr';
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code') ? 'barcode-detector' : 'jsqr';
  } catch {
    return 'jsqr';
  }
}

export class CameraScanner {
  #video;
  #onDecode;
  #stream = null;
  #detector = null;
  #canvas = null;
  #raf = null;
  #timer = null;
  #running = false;
  #paused = false;
  #frame = 0;
  #region;
  #kind = 'jsqr';

  /**
   * @param {HTMLVideoElement} video
   * @param {(text: string) => void} onDecode  fires on every read; the state
   *   machine — not the scanner — decides what a repeat read means.
   * @param {{region?: () => DOMRect | null}} [options]  where the aiming box is
   *   on screen right now, in CSS pixels. Returning null decodes the whole
   *   frame, which is what the enrol screen wants — it has no reticle.
   */
  constructor(video, onDecode, { region = () => null } = {}) {
    this.#video = video;
    this.#onDecode = onDecode;
    this.#region = region;
  }

  get kind() {
    return this.#kind;
  }

  get running() {
    return this.#running;
  }

  /** Opens the camera and starts decoding. Throws if permission is refused. */
  async start() {
    if (this.#running) return;
    this.#stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        // 1080p rather than 720p. Every one of those extra pixels lands inside
        // the reticle crop below, and module size is the whole game: a 38 mm
        // label held at a natural arm's length is a small part of the frame,
        // and it is resolution that decides whether its 0.55 mm modules
        // survive being sampled.
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        // Ignored by most browsers, free where it is not.
        advanced: [{ focusMode: 'continuous' }],
      },
      audio: false,
    });

    this.#video.srcObject = this.#stream;
    this.#video.setAttribute('playsinline', '');
    this.#video.muted = true;
    await this.#video.play();

    this.#kind = await detectorKind();
    if (this.#kind === 'barcode-detector') {
      this.#detector = new BarcodeDetector({ formats: ['qr_code'] });
    }

    this.#running = true;
    this.#tick();
  }

  /**
   * Stop decoding but keep the camera open.
   *
   * The enrol screen uses this once there is a photo: the decode loop is what
   * costs the battery, while dropping the stream means a black viewfinder and
   * a second of getUserMedia the next time the scan screen appears — between
   * every pair of items.
   */
  pause() {
    this.#paused = true;
  }

  resume() {
    if (!this.#paused) return;
    this.#paused = false;
    if (this.#running) this.#schedule();
  }

  get paused() {
    return this.#paused;
  }

  stop() {
    this.#running = false;
    this.#paused = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    if (this.#timer) clearTimeout(this.#timer);
    this.#raf = null;
    this.#timer = null;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#video.srcObject = null;
  }

  async #tick() {
    if (!this.#running || this.#paused) return;
    try {
      const text = await this.#readFrame();
      if (text) this.#onDecode(text);
    } catch {
      // A dropped frame is not an error worth surfacing; keep decoding.
    }
    this.#schedule();
  }

  /**
   * Wait out the interval, then wait for a frame.
   *
   * The timeout is the throttle; the animation frame after it is what stops a
   * backgrounded tab from decoding at all — rAF does not fire when the page is
   * hidden, and a phone in a pocket has no business running jsQR.
   */
  #schedule() {
    if (!this.#running || this.#paused) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.#running || this.#paused) return;
      this.#raf = requestAnimationFrame(() => {
        this.#raf = null;
        this.#tick();
      });
    }, DECODE_INTERVAL_MS);
  }

  async #readFrame() {
    const video = this.#video;
    if (video.readyState < 2 || !video.videoWidth) return null;

    // Most frames look only at the reticle; every fourth looks at everything,
    // so a label held off to one side is still eventually read.
    const wide = this.#frame++ % WIDE_EVERY === 0;
    const crop = wide ? null : this.#cropRect();

    if (this.#detector && !crop) {
      const [hit] = await this.#detector.detect(video);
      return hit?.rawValue ?? null;
    }

    const source = crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
    const scale = Math.min(1, SAMPLE_EDGE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    if (!this.#canvas) this.#canvas = document.createElement('canvas');
    const canvas = this.#canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, width, height);

    if (this.#detector) {
      const [hit] = await this.#detector.detect(canvas);
      return hit?.rawValue ?? null;
    }

    const frame = ctx.getImageData(0, 0, width, height);
    const found = jsQR(frame.data, width, height, { inversionAttempts: 'dontInvert' });
    return found?.data ?? null;
  }

  /**
   * The part of the camera frame the aiming box is actually over.
   *
   * The viewfinder is `object-fit: cover`, so a landscape sensor in a portrait
   * box is cropped at the sides before anyone sees it — and the decoder used to
   * shrink the *whole* sensor frame to 480 px regardless. A 38 mm label held at
   * a comfortable distance came out around half a pixel per module: nothing any
   * decoder can read, and no amount of holding still would fix it.
   *
   * Cropping to the box first spends those 480 pixels where the label is. Same
   * distance, several times the module size, and the reticle now means what it
   * appears to mean.
   */
  #cropRect() {
    const box = this.#region?.();
    if (!box?.width) return null;

    const video = this.#video;
    const shown = video.getBoundingClientRect();
    if (!shown.width || !shown.height) return null;

    // How the browser fitted the sensor into the element, per `object-fit: cover`.
    const cover = Math.max(shown.width / video.videoWidth, shown.height / video.videoHeight);
    const side = Math.min(
      Math.round((box.width * REGION_SLACK) / cover),
      video.videoWidth,
      video.videoHeight,
    );
    if (side < 32) return null;

    // The box is centred on the stage, and cover-fit crops symmetrically, so
    // the source square is centred too.
    return {
      x: Math.round((video.videoWidth - side) / 2),
      y: Math.round((video.videoHeight - side) / 2),
      width: side,
      height: side,
    };
  }

  /** A still frame of whatever the viewfinder is showing, for the photo. */
  async grabFrame() {
    const video = this.#video;
    if (!video.videoWidth) throw new Error('the camera has no frame yet');
    if (globalThis.createImageBitmap) return createImageBitmap(video);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas;
  }
}

/**
 * A Bluetooth ring scanner pairs as an HID keyboard: it types the code and
 * presses Enter. Watching for machine-speed input means a €30 ring scanner is
 * a drop-in upgrade with no code changes — and it doubles as the way to type a
 * scuffed code by hand, which resolves through exactly the same path.
 */
export class KeyboardScanner {
  static MACHINE_CHARS_PER_SECOND = 50;
  static IDLE_MS = 120;

  #buffer = '';
  #startedAt = 0;
  #lastAt = 0;
  #onScan;
  #target;
  #handler;

  /** @param {(text: string, meta: {source: 'hid'|'human'}) => void} onScan */
  constructor(onScan, { target = document } = {}) {
    this.#onScan = onScan;
    this.#target = target;
    this.#handler = (event) => this.#onKey(event);
  }

  start() {
    this.#target.addEventListener('keydown', this.#handler);
  }

  stop() {
    this.#target.removeEventListener('keydown', this.#handler);
  }

  #onKey(event) {
    // Never steal keystrokes from a field the user is actually typing into.
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const now = event.timeStamp || performance.now();
    if (now - this.#lastAt > KeyboardScanner.IDLE_MS) {
      this.#buffer = '';
      this.#startedAt = now;
    }
    this.#lastAt = now;

    if (event.key === 'Enter') {
      const text = this.#buffer;
      this.#buffer = '';
      if (!text) return;
      const seconds = Math.max((now - this.#startedAt) / 1000, 1e-6);
      const speed = text.length / seconds;
      this.#onScan(text, {
        source: speed > KeyboardScanner.MACHINE_CHARS_PER_SECOND ? 'hid' : 'human',
      });
      return;
    }

    if (event.key.length === 1) this.#buffer += event.key;
  }
}
