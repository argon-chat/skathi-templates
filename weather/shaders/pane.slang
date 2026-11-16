import sk;
import weather;

// The frosted glass every panel is made of. It blurs what is behind it and bends it at the rim. In
// rain, drops land on it, bead and run down, each one a little lens that shows the scene sharp and
// upside down, the runners wiping a clear trail through the frost. In snow, frost creeps in from the
// edges and snow settles along the top. Lightning lights it up from the side the bolt struck.
//
// Drops are placed in window pixels, not the panel's, so every panel gets different ones.
[SkEffect("pane")]
[SkDoc("frosted glass with raindrops, frost and lightning")]
[SkBackdrop]
struct Pane : IEffect
{
    [SkLength] [SkBackdropRadius] [SkDefault("20")] [SkRange(0.0, 25.0)]
    float blur;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float rain;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float snow;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float storm;

    // Above 0 while anything on the glass moves; at 0 the panel costs nothing between frames.
    [SkAnimated] [SkDefault("0")] [SkRange(0.0, 1.0)]
    float live;

    // A tiling normal map of misted glass, its slopes stored six times steeper than they are.
    [SkLinear] [SkDefault("#8080ff")]
    SkTexture condensation;

    // A tiling frost pattern: brighter where the crystals are.
    [SkLinear] [SkDefault("#999999")]
    SkTexture frostMask;

    // A bead of water sitting on the glass: xy how far it bends the view, z how much of it there is,
    // w its highlight.
    float4 bead(float2 w, float t, float s, float cellPx, float seed, float amount)
    {
        float cell = cellPx * s;
        float2 id = floor(w / cell);
        float2 h = sk_hash22(id + seed);
        float h3 = sk_hash12(id + seed + 9.1);
        float2 centre = (id + 0.3 + 0.4 * h) * cell;
        float phase = frac(t * (0.05 + 0.05 * h3) + h.x * 7.0);
        float life = smoothstep(0.0, 0.015, phase) * (1.0 - smoothstep(0.55, 1.0, phase));
        float present = step(sk_hash12(id + seed + 3.3), amount);
        float radius = (0.8 + 0.32 * cellPx * h3 * h3) * s * (0.6 + 0.4 * life);
        float2 d = (w - centre) / max(radius, 0.001);
        float mask = (1.0 - smoothstep(0.8, 1.0, length(d))) * life * present;
        return float4(-d * (radius * 2.5 + 5.0 * s), mask, lighting(d) * mask);
    }

    // How a drop catches the light at `d` (its centre 0, its edge 1): a dark rim, a highlight at the
    // top left and the light it focuses at the bottom.
    float lighting(float2 d)
    {
        float r = length(d);
        float rim = smoothstep(0.5, 0.95, r) * (0.6 + 0.4 * saturate(-d.y + 0.3));
        float glint = exp(-dot(d - float2(-0.35, -0.42), d - float2(-0.35, -0.42)) * 22.0);
        float caustic = exp(-dot(d - float2(0.08, 0.5), d - float2(0.08, 0.5)) * 7.0) * (1.0 - smoothstep(0.75, 1.0, r));
        return glint * 0.85 + caustic * 0.3 - rim * 0.32;
    }

    float4 shade(EffectInput input)
    {
        float s = input.scale;
        float t = input.time;
        float2 w = input.uv * sk_viewport_size;

        float2 gradient = float2(ddx(input.sd), ddy(input.sd));
        float2 normal = gradient / max(length(gradient), 1e-4);
        float bevel = 1.0 - saturate(-input.sd / (16.0 * s));
        float4 frosted = input.backdropAtPx(input.px + normal * bevel * bevel * 10.0 * s);

        float2 bend = float2(0.0, 0.0);
        float wet = 0.0;
        float glint = 0.0;
        float wipe = 0.0;
        if (rain > 0.001)
        {
            float4 big = bead(w, t, s, 26.0, 0.0, rain * 0.6);
            float4 small = bead(w, t * 1.3, s, 12.0, 41.0, rain * 0.45);
            bend = big.xy * big.z + small.xy * small.z * (1.0 - big.z);
            wet = max(big.z, small.z);
            glint = big.w + small.w * (1.0 - big.z);

            float colW = 38.0 * s;
            float column = floor(w.x / colW);
            float hc = sk_hash12(float2(column, 77.0));
            float runs = step(hc, rain * 0.75);
            float height = sk_viewport_size.y + 260.0 * s;
            float progress = frac(t * (0.05 + 0.07 * sk_hash12(float2(column, 5.0))) + hc * 13.0);
            float stutter = progress + 0.015 * sin(progress * 37.0 + hc * 20.0);
            float y = stutter * height - 130.0 * s;
            float sway = sin(w.y * 0.021 / s + hc * 30.0) * 5.0 * s + sin(w.y * 0.05 / s + hc * 9.0) * 1.5 * s;
            float x = (column + 0.3 + 0.4 * sk_hash12(float2(column, 2.0))) * colW + sway;
            float rx = (4.0 + 3.0 * sk_hash12(float2(column, 8.0))) * s;
            float2 d = float2(w.x - x, (w.y - y) * 0.75) / rx;
            float r = length(d);
            float runner = (1.0 - smoothstep(0.8, 1.0, r)) * runs;
            float behind = y - w.y;
            float trail = runs * step(0.0, behind) * (1.0 - smoothstep(0.0, 240.0 * s, behind))
                * (1.0 - smoothstep(rx * 0.35, rx * 0.8, abs(w.x - x)));
            float2 dropletCell = float2(w.x - x, w.y) / (7.0 * s);
            float2 did = floor(dropletCell);
            float droplet = step(sk_hash12(did + column), 0.35) * step(abs(did.x), 0.0)
                * (1.0 - smoothstep(0.15, 0.3, length(frac(dropletCell) - 0.5)));
            wipe = trail * 0.8;
            float runnerOrDroplet = max(runner, droplet * trail);
            bend = lerp(bend, -d * (rx * 2.5 + 5.0 * s), runner);
            wet = max(wet, runnerOrDroplet);
            glint = lerp(glint, lighting(d), runner);
        }

        float4 clear = input.rawBackdropAtPx(input.px + bend);
        float4 glass = lerp(frosted, input.rawBackdropAtPx(input.px) * 0.94, wipe * (1.0 - wet));
        glass = lerp(glass, float4(clear.rgb * 1.08, clear.a), wet);
        float2 slope = (condensation.sampleRepeat(w / (720.0 * s)).xy - 0.5) * 2.0;
        float tilt = dot(slope, float2(-0.6, -0.8));
        float mist = saturate(rain * 1.5 + snow * 0.5) * (1.0 - wet) * (1.0 - wipe);
        float fine = (tilt * 0.1 + pow(saturate(tilt * 2.5), 3.0) * 0.3) * mist;
        glass.rgb = max(glass.rgb + (glint * 0.6 + fine) * glass.a, float3(0.0, 0.0, 0.0));

        if (snow > 0.001)
        {
            float2 q = w / s;
            float crystals = sk_fbm(q * 0.06) * 0.7 + sk_fbm(q * 0.23 + 4.0) * 0.3;
            float pattern = frostMask.sampleRepeat(q / 640.0).r;
            float inward = -input.sd / s;
            float reach = (14.0 + 60.0 * crystals + 30.0 * pattern) * snow;
            float edge = 1.0 - smoothstep(reach * 0.3, reach, inward);
            float frost = saturate(edge * (0.35 + 0.9 * pattern) + edge * edge * 0.25) * snow;
            float3 frostCol = lerp(glass.rgb, float3(0.90, 0.92, 1.0) * glass.a, 0.4 + 0.4 * pattern);
            glass.rgb = lerp(glass.rgb, frostCol, saturate(frost));
            float2 cell = floor(q / 3.0);
            float sparkle = step(0.93, sk_hash12(cell)) * frost * (0.5 + 0.5 * sin(t * 3.0 + sk_hash12(cell + 2.0) * 30.0));
            glass.rgb += sparkle * 0.35 * glass.a;

            float capH = snow * (4.0 + 7.0 * sk_fbm(float2(q.x * 0.035, 1.0)) + 2.0 * sk_value_noise(float2(q.x * 0.3, 2.0))) * s;
            float cap = 1.0 - smoothstep(capH - 1.2 * s, capH + 0.4 * s, input.px.y);
            float capShade = 0.82 + 0.18 * saturate(1.0 - input.px.y / max(capH, 1.0));
            float under = (1.0 - smoothstep(capH, capH + 5.0 * s, input.px.y)) * (1.0 - cap);
            glass.rgb *= 1.0 - under * 0.18 * snow;
            glass = lerp(glass, float4(float3(0.97, 0.97, 1.0) * capShade, 1.0), cap * smoothstep(0.05, 0.3, snow));
        }

        float4 bolt = sky_lightning(t, storm);
        float rimLine = pow(saturate(1.0 + input.sd / (1.6 * s)), 2.0);
        float facing = saturate(dot(normal, float2(-0.55, -0.83)));
        float near = exp(-abs(input.uv.x - bolt.y) * 3.0);
        float light = rimLine * (0.10 + 0.28 * facing) + bolt.x * (0.10 + 0.22 * near) + bolt.x * rimLine * 0.9;
        glass.rgb += float3(0.88, 0.84, 1.0) * light * glass.a;
        return glass;
    }
};
