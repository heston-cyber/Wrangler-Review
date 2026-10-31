// Phase 3c · Vendors step 1: the vendor record. T3c.1 (owner side) another business and clients see none of it;
// rates sit beside the business's Pricing costs; one email per business; W-9 status and archive.
import { beforeAll, describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.SITE_URL = "https://app.wranglerportal.com"; });
const jordan = { name: "Jordan Ellis", email: "Jordan@EllisFilms.com", roles: ["Shooter", "Editor"], rates: [{ role: "Shooter", unit: "day", cents: 100_000 }], basedIn: "Oklahoma City" };

describe("vendors", () => {
  test("add, list, the page with Pricing costs, edit, one email per business, archive", async () => {
    const w = await world();
    const id = await w.heston.mutation(api.vendors.add, { ...jordan, invite: true }) as Id<"vendors">;
    expect(await w.heston.query(api.vendors.list, {})).toEqual([expect.objectContaining({ name: "Jordan Ellis", roles: ["Shooter", "Editor"], w9: false, portal: expect.stringMatching(/^invited/) })]);
    const v = await w.heston.query(api.vendors.get, { vendorId: id });
    expect(v).toMatchObject({ email: "jordan@ellisfilms.com", costs: [{ role: "Shooter", cost: { cents: 12_500, unit: "hour" } }, { role: "Editor", cost: { cents: 9_000, unit: "hour" } }] });
    await expect(w.heston.mutation(api.vendors.add, { ...jordan, invite: false })).rejects.toThrow(/already a vendor/);
    await w.heston.mutation(api.vendors.update, { vendorId: id, ...jordan, gear: ["Gimbal", "Gimbal", "Drone"], notes: "Great with crowds." });
    expect(await w.heston.query(api.vendors.get, { vendorId: id })).toMatchObject({ gear: ["Gimbal", "Drone"], notes: "Great with crowds." });
    await w.heston.mutation(api.vendors.archive, { vendorId: id, archived: true });
    expect(await w.heston.query(api.vendors.list, {})).toEqual([]);
    await w.heston.mutation(api.vendors.add, { ...jordan, invite: false }); // an archived vendor's email can be added again
  });

  test("T3c.1 another business and clients see none of it; the same person can be a vendor for two businesses (D94)", async () => {
    const w = await world();
    const id = await w.heston.mutation(api.vendors.add, { ...jordan, invite: false }) as Id<"vendors">;
    expect(await w.boss.query(api.vendors.list, {})).toEqual([]);
    expect(await w.boss.query(api.vendors.get, { vendorId: id })).toBeNull();
    await expect(w.boss.mutation(api.vendors.update, { vendorId: id, ...jordan })).rejects.toThrow();
    await expect(w.maya.query(api.vendors.list, {})).rejects.toThrow();
    await w.boss.mutation(api.vendors.add, { ...jordan, invite: false }); // their own row, separate
    expect(await w.heston.query(api.vendors.list, {})).toHaveLength(1);
  });
});
