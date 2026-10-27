import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Group, Row } from "./settings-group";

type Device = {
  id: string;
  label: string;
  created_at: number;
  last_used_at: number;
  revoked_at: number | null;
};

type Code = { secret: string; expiresAt: number; origin: string };

async function pairingRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/auth/pairing/${path}`, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new Error("Could not complete this request. Please try again.");
  return response.json() as Promise<T>;
}

export function DeviceSettings() {
  const client = useQueryClient();
  const [code, setCode] = useState<Code>();
  const [confirm, setConfirm] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!code) return;
    const timer = window.setTimeout(
      () => {
        setCode(undefined);
        setCopied(false);
        setExpired(true);
      },
      Math.max(0, code.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [code]);
  const devices = useQuery({
    queryKey: ["paired-devices"],
    queryFn: () => pairingRequest<{ devices: Device[] }>("devices"),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => pairingRequest<Code>("create", {}),
    onSuccess: (value) => {
      setExpired(false);
      setCode(value);
    },
  });
  const cancel = useMutation({
    mutationFn: (secret: string) => pairingRequest("cancel", { secret }),
    onSuccess: () => {
      setCode(undefined);
      setCopied(false);
      setCopyError(false);
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => pairingRequest("revoke", { id }),
    onSuccess: () => {
      setConfirm(undefined);
      void client.invalidateQueries({ queryKey: ["paired-devices"] });
    },
  });
  const link = code
    ? `${code.origin}/auth/pairing/page#token=${code.secret}`
    : "";
  const active =
    devices.data?.devices.filter((device) => device.revoked_at === null) ?? [];

  return (
    <>
      <Group
        title="Pair a device"
        note="Connect another browser or the Raphie mobile app."
      >
        <div className="settings-form">
          {!code ? (
            <>
              {expired && (
                <p role="status">
                  The pairing link expired. Create another to connect a device.
                </p>
              )}
              <p>
                Generate a single-use link. Anyone who has it can connect, so
                share it only with a device you trust.
              </p>
              <div>
                <Button
                  disabled={create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "Creating…" : "Create pairing link"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-5 rounded-lg border bg-background p-4">
                <div className="rounded-lg bg-white p-3">
                  <QRCodeSVG value={link} size={160} title="Pairing QR code" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">Scan to connect</h3>
                  <p className="mt-1">
                    Open the Raphie app on your device and scan this code. The
                    link expires at{" "}
                    <time dateTime={new Date(code.expiresAt).toISOString()}>
                      {new Date(code.expiresAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>{" "}
                    and works once.
                  </p>
                </div>
              </div>
              <label htmlFor="pairing-link">Or copy the pairing link</label>
              <Input
                id="pairing-link"
                readOnly
                value={link}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="settings-actions">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCopyError(false);
                    if (!navigator.clipboard) {
                      setCopyError(true);
                      return;
                    }
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => setCopied(true))
                      .catch(() => setCopyError(true));
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(code.secret)}
                >
                  Cancel link
                </Button>
              </div>
              {copyError && (
                <p role="status">
                  Copy is unavailable here. Select the link above and copy it
                  manually.
                </p>
              )}
            </>
          )}
          {(create.error || cancel.error) && (
            <p role="alert">
              Couldn’t update the pairing link. Please try again.
            </p>
          )}
        </div>
      </Group>
      <Group
        title="Connected devices"
        note="Remove access for a device you no longer use."
      >
        {devices.isPending ? (
          <div className="settings-form">
            <p>Loading devices…</p>
          </div>
        ) : devices.isError ? (
          <div className="settings-form">
            <p role="alert">
              Couldn’t load devices. Pairing may be unavailable.
            </p>
            <div>
              <Button variant="outline" onClick={() => void devices.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : active.length === 0 ? (
          <div className="settings-form">
            <p>No paired devices yet.</p>
          </div>
        ) : (
          active.map((device) => (
            <Row
              key={device.id}
              icon={<Smartphone size={16} />}
              title={device.label}
              description={`Last active ${new Date(device.last_used_at).toLocaleDateString()}`}
            >
              {confirm === device.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Remove access?
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(device.id)}
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirm(undefined)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${device.label}`}
                  title="Remove device"
                  onClick={() => setConfirm(device.id)}
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </Row>
          ))
        )}
        {revoke.error && (
          <div className="settings-form">
            <p role="alert">Couldn’t remove this device. Please try again.</p>
          </div>
        )}
      </Group>
    </>
  );
}
