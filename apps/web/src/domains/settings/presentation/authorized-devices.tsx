import { useEffect, useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Group, Row } from "./settings-group";

type Device = {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
};

export function AuthorizedDevices() {
  const [devices, setDevices] = useState<Device[]>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/authorized-devices", { signal: controller.signal })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Device[]>)
          : Promise.reject(new Error()),
      )
      .then(setDevices)
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage("Could not load connected devices. Reload to try again.");
      });
    return () => controller.abort();
  }, []);

  async function revoke(id: string) {
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch("/api/auth/authorized-devices/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error();
      setDevices((current) => current?.filter((device) => device.id !== id));
      setMessage("Device disconnected.");
    } catch {
      setMessage("Could not disconnect that device. Please try again.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Group
      title="Connected devices"
      note="Devices have access to your workspace. Disconnect any device you no longer trust."
    >
      {!devices && !message && (
        <Row
          title="Loading devices…"
          description="Checking connected devices."
        />
      )}
      {devices?.length === 0 && (
        <Row
          title="No connected devices"
          description="Devices you approve will appear here."
        />
      )}
      {devices?.map((device) => (
        <Row
          key={device.id}
          title={device.name}
          description={`Connected ${new Date(device.createdAt).toLocaleDateString()}`}
        >
          <Button
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => void revoke(device.id)}
            aria-label={`Disconnect ${device.name}`}
          >
            {busy === device.id ? "Disconnecting…" : "Disconnect"}
          </Button>
        </Row>
      ))}
      {message && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </Group>
  );
}
