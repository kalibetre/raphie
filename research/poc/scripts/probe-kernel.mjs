// Read-only probe: can the microVM guest kernel host a container runtime? One Alpine VM, deny-all network.
import { Sandbox, MiB } from 'microsandbox';
const name = `raphie-probe-${Date.now()}`;
const probe = `
echo "--- namespaces"; ls /proc/self/ns | tr '\\n' ' '; echo
for ns in "-n" "-p -f" "-m" "-u" "-i" "-U"; do unshare $ns true >/dev/null 2>&1 && echo "unshare $ns: ok" || echo "unshare $ns: FAIL"; done
echo "--- net"; ls /proc/net | tr '\\n' ' ' | cut -c1-300; echo
ip link add vtest0 type veth peer name vtest1 2>&1 | head -2; ip link add brtest0 type bridge 2>&1 | head -2; ip link 2>&1 | head -8
ls /proc/net/ip_tables_names /proc/net/nf_conntrack /proc/sys/net/netfilter 2>&1 | head -5
echo "--- misc"; test -e /dev/fuse && echo fuse-dev; mount -t overlay overlay -o lowerdir=/etc,upperdir=/tmp,workdir=/tmp /mnt 2>&1 | head -2; cat /proc/sys/kernel/unprivileged_userns_clone 2>&1
`;let sandbox;
try {
  sandbox = await Sandbox.builder(name).image('docker.io/library/alpine:3.22').cpus(1).memory(MiB(512)).create();
  const out = await sandbox.execWith('/bin/sh', o => o.args(['-c', probe]).timeout(30_000));
  console.log(out.stdout()); console.log(out.stderr());
} finally {
  if (sandbox) { await sandbox.stop(); await Sandbox.remove(name); }
}
