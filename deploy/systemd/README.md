# TokenTelemetry systemd guardrails

Use this drop-in for any systemd-managed TokenTelemetry backend service. It
keeps the backend cgroup from spilling an application memory leak into
unbounded swap while still allowing a small swap cushion.

Install it next to the unit that runs the backend, usually:

```bash
mkdir -p ~/.config/systemd/user/tokentelemetry.service.d
cp deploy/systemd/tokentelemetry.service.d/10-resource-guardrails.conf \
  ~/.config/systemd/user/tokentelemetry.service.d/
systemctl --user daemon-reload
systemctl --user restart tokentelemetry.service
```

The unit or drop-in that ships with a deployment should carry these settings:

- `MemoryHigh=1.5G`
- `MemoryMax=2G`
- `MemorySwapMax=512M`
- `Restart=on-failure`

Do not leave `MemorySwapMax` at systemd's default infinity; that lets a backend
leak turn into host-wide swap I/O pressure.
