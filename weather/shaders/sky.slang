import sk;
import weather;

// The sky behind the landscape: the painted dawn, day, dusk and night skies blended by the sun's
// height, graded for the weather, with the sun or the moon and stars, drifting clouds and lightning.
// Every number blends in a CSS transition on `--shading` while the clouds keep moving.
[SkEffect("sky")]
[SkDoc("the painted sky for the current weather and time of day")]
struct Sky : IEffect
{
    SkTexture dawnSky;
    SkTexture daySky;
    SkTexture duskSky;
    SkTexture nightSky;

    // The sun's height: -1 deep night, 0 on the horizon, 1 high noon.
    [SkDefault("0.1")] [SkRange(-1.0, 1.0)]
    float daylight;

    // Where the sun (or the moon) stands, 0..1 across the window.
    [SkDefault("0.75")] [SkRange(0.0, 1.0)]
    float sun;

    [SkDefault("0.4")] [SkRange(0.0, 1.0)]
    float cloud;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float fog;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float storm;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float snow;

    [SkAnimated] [SkDefault("1")] [SkRange(0.0, 8.0)]
    float speed;

    float4 shade(EffectInput input)
    {
        float t = input.time * speed;
        float aspect = input.size.x / max(input.size.y, 1.0);
        float2 p = float2(input.local.x * aspect, input.local.y);
        float d = daylight;
        float tDay = day_amount(d);
        float tNight = night_amount(d);
        float overcast = smoothstep(0.35, 1.0, cloud);

        float3 top = tod(d, float3(0.30, 0.36, 0.78), float3(0.15, 0.13, 0.40), float3(0.025, 0.025, 0.09));
        float3 mid = tod(d, float3(0.53, 0.56, 0.90), float3(0.45, 0.33, 0.70), float3(0.07, 0.06, 0.19));
        float3 low = tod(d, float3(0.84, 0.80, 0.96), float3(1.0, 0.62, 0.56), float3(0.17, 0.12, 0.31));
        float g = saturate(p.y / 0.4);
        float3 col = lerp(top, mid, smoothstep(0.0, 0.55, g));
        col = lerp(col, low, smoothstep(0.45, 1.0, g) * smoothstep(0.45, 1.0, g));
        float4 plate = blend_plates(dawnSky, daySky, duskSky, nightSky, plate_weights(d, sun), plate_uv(input.local, input.size));
        col = lerp(col, plate.rgb / max(plate.a, 1e-4), plate.a);

        float3 grey = float3(1.0, 1.0, 1.0) * sk_luma(col);
        col = lerp(col, grey * float3(0.82, 0.80, 0.98), overcast * 0.6);
        col *= 1.0 - 0.2 * overcast - 0.5 * storm;
        col = lerp(col, float3(0.80, 0.80, 0.90) * (0.45 + 0.55 * tDay) * (1.0 - 0.7 * tNight), snow * 0.35);

        float sunY = 0.34 - 0.28 * saturate(d + 0.04);
        float2 sunAt = float2(sun * aspect, sunY);
        float sunDist = length(p - sunAt);
        float3 sunTint = lerp(float3(1.0, 0.62, 0.42), float3(1.0, 0.95, 0.85), tDay);
        float sunUp = smoothstep(-0.12, 0.02, d);
        float clear = 1.0 - overcast * 0.85;
        col += sunTint * sunUp * clear * (0.45 * exp(-sunDist * 3.2) + 0.25 * exp(-sunDist * 10.0)) * (1.0 - 0.5 * tDay);
        float disc = smoothstep(0.034, 0.028, sunDist);
        col = lerp(col, float3(1.0, 0.97, 0.88), disc * sunUp * clear);

        float2 moonAt = float2(lerp(0.2, 0.8, sun) * aspect, 0.15);
        float moonDist = length(p - moonAt);
        float moon = smoothstep(0.026, 0.022, moonDist) * smoothstep(0.019, 0.026, length(p - moonAt - float2(0.011, -0.006)));
        col += float3(0.70, 0.68, 0.95) * tNight * clear * exp(-moonDist * 9.0) * 0.18;

        float lattice = 6.0 * input.scale;
        float2 cell = floor(input.px / lattice);
        float2 spot = (cell + 0.2 + 0.6 * sk_hash22(cell + 11.0)) * lattice;
        float size = (0.35 + 0.8 * sk_hash12(cell + 5.0)) * input.scale;
        float star = step(0.97, sk_hash12(cell)) * input.aa(length(input.px - spot) - size);
        float twinkle = 0.55 + 0.45 * sin(input.time * (1.2 + 2.5 * sk_hash12(cell + 7.0)) + 40.0 * sk_hash12(cell + 3.0));
        float darkSky = saturate(1.0 - (sk_luma(col) - 0.12) * 5.0);
        col += float3(0.9, 0.88, 1.0) * star * twinkle * tNight * (1.0 - overcast) * darkSky * smoothstep(0.4, 0.15, p.y);
        col = lerp(col, float3(1.0, 0.96, 0.86), moon * tNight * clear);

        float4 bolt = sky_lightning(input.time, storm);
        float boltX = bolt.y * aspect;
        float boltLen = 0.30 + 0.12 * sk_hash12(float2(bolt.z, 2.0));
        float along = saturate((p.y - 0.06) / boltLen);
        float jag = (ridge_noise(p.y * 16.0, bolt.z) - 0.5) * 0.07 + (ridge_noise(p.y * 55.0, bolt.z + 4.0) - 0.5) * 0.02;
        float lane = abs(p.x - boltX - jag - (along - 0.5) * 0.06);
        float inBolt = smoothstep(0.03, 0.09, p.y) * smoothstep(0.08 + boltLen, 0.04 + boltLen, p.y);
        float branchY = 0.06 + boltLen * 0.35;
        float branchSide = sk_hash12(float2(bolt.z, 6.0)) > 0.5 ? 1.0 : -1.0;
        float branchJag = (ridge_noise(p.y * 30.0, bolt.z + 9.0) - 0.5) * 0.03;
        float branchLane = abs(p.x - boltX - (p.y - branchY) * 0.7 * branchSide - branchJag);
        float inBranch = smoothstep(branchY - 0.01, branchY + 0.02, p.y) * smoothstep(branchY + boltLen * 0.4, branchY + boltLen * 0.25, p.y);
        float visible = step(bolt.w, 0.42) * step(0.0, bolt.w) * saturate(bolt.x * 3.0);
        float core = max(exp(-lane * 900.0) * inBolt, 0.6 * exp(-branchLane * 1100.0) * inBranch * (1.0 - along));
        float halo = max(exp(-lane * 70.0) * inBolt, 0.5 * exp(-branchLane * 90.0) * inBranch);

        float3 cloudDark = tod(d, float3(0.50, 0.52, 0.80), float3(0.30, 0.23, 0.52), float3(0.06, 0.06, 0.15));
        float3 cloudLit = tod(d, float3(1.0, 0.99, 1.0), float3(1.0, 0.80, 0.68), float3(0.32, 0.32, 0.52));
        cloudDark = lerp(cloudDark, float3(0.16, 0.14, 0.24), storm);
        cloudLit = lerp(cloudLit, lerp(cloudDark, float3(0.62, 0.60, 0.72), 0.5), max(storm, overcast * 0.6));
        float3 boltLight = float3(0.75, 0.70, 1.0) * bolt.x * (0.5 + 0.8 * exp(-abs(p.x - boltX) * 2.5));
        float2 toSun = normalize(sunAt - p + float2(0.0001, 0.0));

        float cover = saturate((cloud - 0.15) / 0.85);
        float2 cp = float2(p.x * 1.2, p.y * 3.0) + float2(t * 0.006, 0.0);
        float2 warp = float2(sk_fbm(cp * 0.5 + 3.1), sk_fbm(cp * 0.5 + float2(7.3, 2.1))) - 0.5;
        float2 q = cp + warp * 0.9;
        float2 lean = toSun * float2(1.2, 3.0) * 0.06;
        float dens = sk_fbm(q) * 0.65 + sk_fbm(q * 2.3 + 5.0) * 0.35;
        float densSun = sk_fbm(q + lean) * 0.65 + sk_fbm((q + lean) * 2.3 + 5.0) * 0.35;
        float edge = lerp(0.8, 0.32, cover);
        float body = smoothstep(edge, edge + 0.3, dens) * smoothstep(lerp(0.4, 0.6, overcast), 0.08, p.y) * step(0.001, cover);
        float lit = saturate(0.5 + (dens - densSun) * 6.0) * lerp(1.0, 0.55, overcast);
        float3 cloudCol = lerp(lerp(cloudDark, cloudLit, lit), col, 0.25);
        float rim = body * (1.0 - body) * 4.0 * exp(-sunDist * 2.0) * sunUp * (1.0 - overcast);
        cloudCol += sunTint * rim * 0.35 + boltLight * (0.5 + 0.5 * (1.0 - lit));
        col = lerp(col, cloudCol, body * lerp(0.5, 0.95, overcast) * (1.0 - fog * 0.5));
        col += float3(0.85, 0.82, 1.0) * halo * visible * 0.5;
        col = lerp(col, float3(0.98, 0.96, 1.0), core * visible);

        float3 fogCol = lerp(low, float3(0.80, 0.78, 0.90), 0.6) * (0.3 + 0.7 * (1.0 - tNight)) * (1.0 - 0.5 * storm);
        col = lerp(col, fogCol, fog * 0.55);
        col += float3(0.70, 0.66, 1.0) * bolt.x * 0.25;
        return float4(col, 1.0);
    }
};
