import { jsQR } from '../../../vendor/jsqr.js';

/**
 * Continuous QR decoding from a live camera.
 *
 * `BarcodeDetector` is used where the platform has it (Chrome/Android) because
 * it decodes on the GPU and costs almost nothing; jsQR is the fallback for
 * Safari/iOS. Feature-detected, never user-agent sniffed.
 */

const SAMPLE_EDGE = 480; // downscale before software decoding — full frames are wasteful

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
  #running = false;
  #kind = 'jsqr';

  /**
   * @param {HTMLVideoElement} video
   * @param {(text: string) => void} onDecode  fires on every read; the state
   *   machine — not the scanner — decides what a repeat read means.
   */
  constructor(video, onDecode) {
    this.#video = video;
    this.#onDecode = onDecode;
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
        width: { ideal: 1280 },
        height: { ideal: 720 },
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

  stop() {
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = null;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#video.srcObject = null;
  }

  async #tick() {
    if (!this.#running) return;
    try {
      const text = await this.#readFrame();
      if (text) this.#onDecode(text);
    } catch {
      // A dropped frame is not an error worth surfacing; keep decoding.
    }
    if (this.#running) this.#raf = requestAnimationFrame(() => this.#tick());
  }

  async #readFrame() {
    const video = this.#video;
    if (video.readyState < 2 || !video.videoWidth) return null;

    if (this.#detector) {
      const [hit] = await this.#detector.detect(video);
      return hit?.rawValue ?? null;
    }

    const scale = Math.min(1, SAMPLE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    if (!this.#canvas) this.#canvas = document.createElement('canvas');
    const canvas = this.#canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    const found = jsQR(frame.data, width, height, { inversionAttempts: 'dontInvert' });
    return found?.data ?? null;
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
