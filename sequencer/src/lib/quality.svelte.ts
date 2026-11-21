// How much detail the effects draw. `auto` leaves it to the host, which follows CPU pressure, the
// power mode and the battery; the other three pin a tier with the `effect-quality` property.

const TIERS = ["auto", "full", "reduced", "minimal"] as const;
export type Tier = (typeof TIERS)[number];

class Quality {
  tier = $state<Tier>("auto");
  /** What the host last said about the CPU: `nominal`, `fair`, `serious` or `critical`. */
  pressure = $state("");

  constructor() {
    if (typeof PressureObserver === "undefined") return;
    const observer = new PressureObserver((records) => {
      const last = records.at(-1);
      if (last) this.pressure = `CPU ${last.state}`;
    });
    void observer.observe("cpu", { sampleInterval: 2000 });
  }

  next(): void {
    this.tier = TIERS[(TIERS.indexOf(this.tier) + 1) % TIERS.length] ?? "auto";
  }
}

export const quality = new Quality();
