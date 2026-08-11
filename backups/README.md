# backups

Drop exported `catalog-*.zip` bundles here and commit them.

Browser storage is not a place to keep the only copy of anything: a cleared
site-data setting, a reinstalled browser, or an eviction under storage pressure
takes the catalog with it. A bundle in git is the copy that survives.

Each bundle holds `catalog.json`, `catalog.csv` and `photos/<ID>.jpg`.
Restore with **Backup → Import…** in the app.
