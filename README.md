# bundle-linux — split ValveOFF bundle payload

This branch hosts only the compiled ValveOFF one-paste bundle, split into
sub-100 MB parts so GitHub accepts them as normal files (no Release asset,
no auto-generated "Source code" download).

| File | Description |
|------|-------------|
| `valveoff-bundle.tar.gz.00.part` | Part 1 of the gzip tarball |
| `valveoff-bundle.tar.gz.01.part` | Part 2 of the gzip tarball |
| `valveoff-bundle.tar.gz.sha256`  | SHA256 of the reassembled tarball |

Reassemble:

```bash
cat valveoff-bundle.tar.gz.00.part valveoff-bundle.tar.gz.01.part > valveoff-bundle.tar.gz
sha256sum -c valveoff-bundle.tar.gz.sha256
tar -xzf valveoff-bundle.tar.gz
```

The one-paste installer on `main` does this automatically.

**No application source code is stored here or anywhere in this repository's
history** — only compiled binaries inside the tarball.
