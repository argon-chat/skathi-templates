import sk;

// Candy-coloured aurora curtains over a violet night, with stars and the odd four-point sparkle. The three
// backdrops (aurora, bubbles, stardust) take the same arguments, so a transition on `--shading` cross-fades
// from one to another as smoothly as it blends `mood` or the colours of the next track.
[SkEffect("aurora")]
[SkDoc("pastel aurora curtains, stars and sparkles on a dark violet sky")]
struct Aurora : IEffect
{
    [SkAnimated] [SkDefault("0.05")] [SkRange(0.0, 1.0)]
    float speed;

    // 0 is a hushed sky (paused), 1 the full show (playing).
    [SkDefault("1")] [SkRange(0.0, 1.0)]
    float mood;

    [SkColor] [SkDefault("#f7a8d0")]
    float4 first;

    [SkColor] [SkDefault("#9fcdf5")]
    float4 second;

    [SkPointer]
    float2 at;

    [SkPointerTimes]
    float3 seen;

    float sparkle(float2 d, float size)
    {
        float2 a = abs(d) / size;
        float cross = exp(-a.x * 7.0) * exp(-a.y * 0.9) + exp(-a.y * 7.0) * exp(-a.x * 0.9);
        return cross * exp(-length(a) * 0.8);
    }

    float4 shade(EffectInput input)
    {
        float t = input.time * speed;
        float2 p = input.centered();
        float3 rgb = lerp(float3(0.090, 0.086, 0.118), float3(0.135, 0.105, 0.180), smoothstep(-1.2, 1.4, p.y));

        float show = 0.4 + 0.6 * mood;
        for (int i = 0; i < 3; i++)
        {
            float fi = float(i);
            float x = p.x * (0.9 + 0.25 * fi) + fi * 2.3;
            float edge = -0.15 + 0.32 * fi - 0.35
                + 0.16 * sin(x * 1.7 + t * (5.0 + 1.5 * fi))
                + 0.30 * (sk_fbm(float2(x * 0.9 + t * 2.0, fi * 4.1 + t * 0.7)) - 0.5);
            float above = edge - p.y;
            float curtain = above > 0.0 ? exp(-above * (2.4 + fi)) : exp(above * 26.0);
            float rays = 0.55 + 0.45 * sk_value_noise(float2(x * 22.0 + 9.0 * sin(t * 2.0 + fi), fi * 7.0 + t * 1.5));
            float3 tint = lerp(first.rgb, second.rgb, saturate(0.5 + 0.5 * sin(x * 0.8 + t * 3.0 + fi * 2.1)));
            tint = lerp(tint, float3(0.788, 0.655, 0.961), fi == 1.0 ? 0.45 : 0.0);
            rgb += tint * curtain * rays * (0.42 - 0.08 * fi) * show;
        }

        // Soft glows low in the sky so the bottom of the window never reads as flat black.
        float2 g1 = p - float2(-0.9 + 0.2 * sin(t * 1.3), 0.95);
        float2 g2 = p - float2(1.0 + 0.15 * cos(t * 1.1), 0.75);
        rgb += first.rgb * 0.16 * exp(-dot(g1, g1) * 1.6) * show;
        rgb += second.rgb * 0.13 * exp(-dot(g2, g2) * 1.8) * show;

        float lattice = 9.0 * input.scale;
        float2 cell = floor(input.px / lattice);
        float2 spot = (cell + 0.2 + 0.6 * sk_hash22(cell + 11.0)) * lattice;
        float size = (0.45 + 0.8 * sk_hash12(cell + 5.0)) * input.scale;
        float twinkle = 0.45 + 0.55 * sin(input.time * (1.0 + 2.5 * sk_hash12(cell + 7.0)) + 40.0 * sk_hash12(cell + 3.0));
        float star = step(0.972, sk_hash12(cell)) * input.aa(length(input.px - spot) - size) * twinkle;
        rgb += lerp(float3(1.0, 0.95, 0.98), float3(0.984, 0.878, 0.627), sk_hash12(cell + 2.0)) * star * 0.8;

        float big = 70.0 * input.scale;
        float2 bcell = floor(input.px / big);
        float2 bspot = (bcell + 0.25 + 0.5 * sk_hash22(bcell + 31.0)) * big;
        float blink = pow(saturate(sin(input.time * (0.6 + 0.8 * sk_hash12(bcell + 4.0)) + 6.28 * sk_hash12(bcell + 8.0))), 6.0);
        float glint = step(0.86, sk_hash12(bcell + 17.0)) * sparkle(input.px - bspot, 9.0 * input.scale) * blink;
        rgb += lerp(float3(0.984, 0.878, 0.627), float3(0.969, 0.659, 0.816), sk_hash12(bcell + 9.0)) * glint * (0.5 + 0.5 * mood);

        float near = sk_pointer_presence(seen, input.time, 0.6);
        float2 toward = (input.local - at) * input.size / max(min(input.size.x, input.size.y), 1.0);
        rgb += float3(0.788, 0.655, 0.961) * 0.07 * near * exp(-dot(toward, toward) * 9.0);

        rgb += (sk_hash12(input.px + frac(input.time) * 97.0) - 0.5) / 255.0;
        return float4(rgb, 1.0);
    }
};
