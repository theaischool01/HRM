import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { HubSubNav, ORG_HUB_TABS } from "@/components/hub-subnav";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { errorToAccessScreen } from "@/components/access-denied";
import { listOfficeLocations, saveOfficeLocation } from "@/lib/locations.functions";
import { readBrowserPosition } from "@/lib/geo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/office-locations")({
  head: () => ({
    meta: [
      { title: "Office locations | The AI School HRM" },
      {
        name: "description",
        content:
          "Configure the office sites and geofence radius used to verify work-from-office check-ins.",
      },
      { property: "og:title", content: "Office locations | The AI School HRM" },
      {
        property: "og:description",
        content: "Manage office coordinates and the check-in radius for WFO verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: OfficeLocationsPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

const BLANK = {
  id: "",
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  radiusMeters: "70",
  isActive: true,
};

function OfficeLocationsPage() {
  const actor = useActor();
  const queryClient = useQueryClient();
  const canManage = actor.can("org:manage:all");
  const { data } = useSuspenseQuery({
    queryKey: ["office-locations"],
    queryFn: () => listOfficeLocations(),
  });
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const existingOffice = form.id
    ? data.offices.find((o) => o.id === form.id)
    : undefined;

  async function save() {
    setBusy(true);
    try {
      await saveOfficeLocation({
        data: {
          ...(form.id ? { id: form.id } : {}),
          name: form.name,
          address: form.address || null,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          radiusMeters: Number(form.radiusMeters),
          isActive: form.isActive,
        },
      });
      toast.success(form.id ? "Office updated." : "Office added.");
      setConfirmDeactivate(false);
      setForm(BLANK);
      await queryClient.invalidateQueries({ queryKey: ["office-locations"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the office.");
    } finally {
      setBusy(false);
    }
  }

  async function useMyPosition() {
    setLocating(true);
    try {
      const pos = await readBrowserPosition();
      setForm((f) => ({
        ...f,
        latitude: String(pos.latitude),
        longitude: String(pos.longitude),
      }));
      toast.success("Coordinates filled from your current position.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Location unavailable.");
    } finally {
      setLocating(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (existingOffice?.is_active && !form.isActive) {
      setConfirmDeactivate(true);
      return;
    }
    void save();
  }

  const canSave =
    Boolean(form.name.trim()) &&
    form.latitude.trim() !== "" &&
    form.longitude.trim() !== "" &&
    !Number.isNaN(Number(form.latitude)) &&
    !Number.isNaN(Number(form.longitude));

  return (
    <AppShell
      title="Office locations"
      description="Work-from-office check-ins are only accepted inside one of these radii."
    >
      <HubSubNav tabs={ORG_HUB_TABS} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Configured offices</CardTitle>
            <CardDescription>
              Only active offices are used to verify a work-from-office check-in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.offices.length === 0 && (
              <p className="text-sm text-muted-foreground">No offices configured yet.</p>
            )}
            {data.offices.map((office) => (
              <div
                key={office.id}
                className={`flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm ${
                  form.id === office.id ? "border-primary/60 bg-primary/5" : ""
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />
                    <span>{office.name}</span>
                    <Badge variant={office.is_active ? "success" : "neutral"}>
                      {office.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {office.address && (
                    <p className="text-muted-foreground">{office.address}</p>
                  )}
                  <p className="tabular-nums text-xs text-muted-foreground">
                    {Number(office.latitude).toFixed(6)}, {Number(office.longitude).toFixed(6)} ·
                    radius {office.radius_meters}m
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setForm({
                        id: office.id,
                        name: office.name,
                        address: office.address ?? "",
                        latitude: String(office.latitude),
                        longitude: String(office.longitude),
                        radiusMeters: String(office.radius_meters),
                        isActive: office.is_active,
                      })
                    }
                  >
                    Edit
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{form.id ? "Edit office" : "Add office"}</CardTitle>
              <CardDescription>
                A tighter radius is stricter; GPS accuracy on phones is typically 10–50m.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="office-name">Name</Label>
                  <Input
                    id="office-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="AV HUB"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="office-address">Address (optional)</Label>
                  <Input
                    id="office-address"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="office-lat">Latitude</Label>
                    <Input
                      id="office-lat"
                      required
                      inputMode="decimal"
                      value={form.latitude}
                      onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                      placeholder="17.440396"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="office-lng">Longitude</Label>
                    <Input
                      id="office-lng"
                      required
                      inputMode="decimal"
                      value={form.longitude}
                      onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                      placeholder="78.386981"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="office-radius">Radius (metres)</Label>
                  <Input
                    id="office-radius"
                    type="number"
                    min={20}
                    max={5000}
                    value={form.radiusMeters}
                    onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })}
                  />
                </div>
                <label
                  htmlFor="office-active"
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    id="office-active"
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  <span>Active (used for WFO geofence verification)</span>
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="submit" disabled={busy || locating || !canSave}>
                    {busy ? "Saving…" : form.id ? "Save changes" : "Add office"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={locating || busy}
                    onClick={() => void useMyPosition()}
                  >
                    {locating ? "Locating…" : "Use my position"}
                  </Button>
                  {form.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setForm(BLANK)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {form.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Employees checking in under Work-From-Office (WFO) at{" "}
              <span className="font-medium text-foreground">{form.name}</span> will no longer match
              this geofence until it is re-activated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {busy ? "Saving…" : "Deactivate office"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
