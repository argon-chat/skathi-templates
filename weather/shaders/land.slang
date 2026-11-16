import sk;
import weather;

// The painted mountains and valley in front of the sky, blended by the sun's height like the sky,
// then weathered: dimmed and greyed under cloud, whitened by snow, veiled by drifting fog and lit
// by lightning.
[SkEffect("land")]
[SkDoc("the painted landscape for the current weather and time of day")]
struct Land : IEffect
{
    SkTexture dawnLand;
    SkTexture dayLand;
    SkTexture duskLand;
    SkTexture nightLand;

    [SkDefault("0.1")] [SkRange(-1.0, 1.0)]
    float daylight;

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

        float4 plate = blend_plates(dawnLand, dayLand, duskLand, nightLand, plate_weights(d, sun), plate_uv(input.local, input.size));
        float a = plate.a;
        float3 col = plate.rgb / max(a, 1e-4);
        float far = smoothstep(0.85, 0.3, p.y);

        float luma = sk_luma(col);
        col = lerp(col, luma * float3(0.84, 0.82, 0.98), overcast * 0.5 + storm * 0.25);
        col *= 1.0 - 0.18 * overcast - 0.4 * storm;

        float drift = sk_fbm(p * float2(9.0, 14.0)) - 0.5;
        float settled = saturate((luma - 0.2) * 2.2 + drift * 0.8 + far * 0.3);
        float3 snowCol = tod(d, float3(0.93, 0.94, 1.0), float3(0.86, 0.80, 0.92), float3(0.36, 0.38, 0.55));
        col = lerp(col, snowCol, snow * (0.25 + 0.6 * settled));

        float3 low = tod(d, float3(0.84, 0.80, 0.96), float3(1.0, 0.62, 0.56), float3(0.17, 0.12, 0.31));
        float3 fogCol = lerp(low, float3(0.80, 0.78, 0.90), 0.6) * (0.3 + 0.7 * (1.0 - tNight)) * (1.0 - 0.5 * storm);
        col = lerp(col, fogCol, fog * (0.3 + 0.4 * far));
        for (int band = 0; band < 3; band++)
        {
            float b = float(band);
            float y0 = 0.42 + 0.12 * b;
            float2 bp = float2(p.x * (1.4 + 0.5 * b) + t * (0.015 + 0.01 * b) + b * 3.7, (p.y - y0) * 9.0);
            float wisp = sk_fbm(bp + float2(0.0, sk_fbm(bp * 0.6) * 1.5));
            float off = p.y - y0 - (wisp - 0.5) * 0.08;
            float bank = exp(-off * off * 160.0) * smoothstep(0.3, 0.7, wisp) * (0.75 + 0.1 * b);
            col = lerp(col, fogCol * (1.0 + 0.08 * (2.0 - b)), saturate(bank * fog * 1.3));
        }
        float lowLying = smoothstep(0.55, 0.9, p.y) * (0.55 + 0.45 * sk_fbm(float2(p.x * 2.0 + t * 0.02, p.y * 6.0)));
        col = lerp(col, fogCol, saturate(fog * lowLying));

        float4 bolt = sky_lightning(input.time, storm);
        float near = exp(-abs(input.local.x - bolt.y) * 2.5);
        col += float3(0.72, 0.68, 1.0) * bolt.x * (0.12 + 0.35 * near) * (0.4 + 0.6 * far);

        float3 ground = lerp(float3(0.10, 0.08, 0.20), float3(0.03, 0.03, 0.08), tNight);
        col = lerp(col, ground, smoothstep(0.8, 1.05, p.y) * 0.4);
        return float4(col * a, a);
    }
};
