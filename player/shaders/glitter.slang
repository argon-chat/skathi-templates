import sk;

// Scatters the element's own painting into drifting glitter and gathers it back. `progress` is a plain
// number: the page moves it to 1, swaps the text while it is all glitter, and lets a transition on
// `--shading` bring it back to 0.
[SkEffect("glitter")]
[SkDoc("scatters the element's painting into pastel glitter; progress 0..1")]
[SkContent]
struct Glitter : IEffect
{
    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float progress;

    [SkLength] [SkDefault("3")] [SkRange(1.0, 32.0)]
    float grain;

    [SkLength] [SkBleed] [SkDefault("28")] [SkRange(0.0, 128.0)]
    float spread;

    float4 shade(EffectInput input)
    {
        float s = max(grain, 1.0);
        float2 cell = floor(input.px / s);
        float2 h = sk_hash22(cell);
        float delay = sk_hash12(cell + 4.0) * 0.4;
        float k = saturate((progress - delay * (1.0 - progress)) / (1.0 - delay * 0.5));
        float2 drift = ((h - 0.5) * float2(1.0, 0.6) + float2(0.15, -0.55)) * spread * k * 2.0;
        float4 seen = input.contentAtPx(input.px - drift);

        float3 sparkle = sk_palette(h.x + input.time * 0.3, float3(0.85, 0.78, 0.9), float3(0.15, 0.15, 0.12), float3(1.0, 1.0, 1.0), float3(0.0, 0.33, 0.67));
        float twinkle = 0.5 + 0.5 * sin(input.time * 14.0 + h.y * 40.0);
        float lit = k * (1.0 - k) * 4.0;
        float3 rgb = lerp(seen.rgb, sparkle * seen.a, saturate(lit * (0.6 + 0.4 * twinkle)));
        float keep = 1.0 - smoothstep(0.55, 1.0, k * (0.75 + 0.5 * h.y));
        return float4(rgb, seen.a) * keep;
    }
};
