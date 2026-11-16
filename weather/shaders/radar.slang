import sk;

// Weather radar in the app's colours. It reads the radar tiles painted inside the element, takes
// their strength from how dark and opaque each pixel is, and paints that blue to violet to pink
// with a soft glow. With `synth` above 0 it adds drifting rain cells of its own, for when there is
// no radar to show; `phase` moves them, so playing a forecast is a transition of one number.
[SkEffect("radar")]
[SkDoc("recolours radar tiles, or makes up rain cells, with a glow")]
[SkContent]
struct Radar : IEffect
{
    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float synth;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float phase;

    [SkAnimated] [SkDefault("1")] [SkRange(0.0, 4.0)]
    float speed;

    static override bool straightAlpha() { return true; }

    float strength(float4 c)
    {
        float3 rgb = c.rgb / max(c.a, 1e-3);
        return c.a * saturate(0.35 + (1.0 - sk_luma(rgb)) * 0.9);
    }

    float4 shade(EffectInput input)
    {
        float s = input.scale;
        float here = strength(input.content);
        float glow = 0.0;
        for (int i = 0; i < 8; i++)
        {
            float a = float(i) * 0.785398;
            glow += strength(input.contentAtPx(input.px + float2(cos(a), sin(a)) * 7.0 * s));
        }
        glow /= 8.0;

        float2 q = input.px / (70.0 * s) + float2(phase * 2.2, phase * 0.5) + float2(input.time * speed * 0.01, 0.0);
        float cells = smoothstep(0.52, 0.78, sk_fbm(q) * 0.75 + sk_fbm(q * 2.7 + 5.0) * 0.25);
        float made = cells * synth;

        float rain = max(here, made);
        float3 colour = lerp(float3(0.36, 0.52, 1.0), float3(0.60, 0.42, 1.0), smoothstep(0.2, 0.55, rain));
        colour = lerp(colour, float3(1.0, 0.46, 0.82), smoothstep(0.6, 0.95, rain));
        float alpha = saturate(rain * 1.1) * 0.85 + glow * 0.35 * (1.0 - rain);
        return float4(colour + glow * 0.15, saturate(alpha));
    }
};
