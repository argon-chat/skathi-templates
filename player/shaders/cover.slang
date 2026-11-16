import sk;

// Placeholder album art: a swirl of three candy colours, marbled by warped noise, pressed like a record with
// faint grooves and a gloss across the top. `seed` is a plain number, so a transition on `--shading`
// morphs one track's swirl into the next.
[SkEffect("cover")]
[SkDoc("candy marble record art from three colours and a seed")]
struct Cover : IEffect
{
    [SkDefault("0")] [SkRange(-100.0, 100.0)]
    float seed;

    [SkColor] [SkDefault("#f7a8d0")]
    float4 first;

    [SkColor] [SkDefault("#c9a7f5")]
    float4 second;

    [SkColor] [SkDefault("#9fcdf5")]
    float4 third;

    float4 shade(EffectInput input)
    {
        float2 p = input.centered();
        float r = length(p);
        float2 q = sk_rotate(p, seed * 0.7 + r * 2.4);
        float2 warp = float2(sk_fbm(q * 1.6 + seed), sk_fbm(q * 1.6 - seed + 3.7));
        float bands = sin((q.x + q.y * 0.6) * 4.5 + warp.x * 5.0 + seed) * 0.5 + 0.5;
        float swirl = sk_fbm(q * 2.2 + warp * 2.4);

        float3 rgb = lerp(first.rgb, second.rgb, smoothstep(0.2, 0.8, bands));
        rgb = lerp(rgb, third.rgb, smoothstep(0.45, 0.75, swirl));
        rgb = lerp(rgb, float3(1.0, 0.97, 0.99), smoothstep(0.82, 0.98, bands) * 0.5);
        rgb *= 0.86 + 0.14 * smoothstep(1.0, 0.3, r);

        float grooves = 0.5 + 0.5 * sin(r * input.size.x / input.scale * 0.9);
        rgb *= 1.0 - 0.035 * grooves * smoothstep(0.3, 0.4, r);

        float gloss = exp(-pow((p.y + 0.55 + 0.25 * p.x * p.x) / 0.22, 2.0)) * 0.22;
        float2 shine = p - float2(-0.42, -0.5);
        gloss += exp(-dot(shine, shine) * 10.0) * 0.18;
        rgb += gloss;

        // A darker label ring round the middle for the wolf to sit on.
        float label = smoothstep(0.42, 0.40, r);
        rgb = lerp(rgb, rgb * 0.55 + float3(0.06, 0.04, 0.09), label * 0.65);
        float lip = exp(-pow((r - 0.41) / 0.012, 2.0));
        rgb += float3(1.0, 0.95, 1.0) * lip * 0.25;

        return float4(saturate(rgb), 1.0);
    }
};
