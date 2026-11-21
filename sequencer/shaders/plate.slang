import sk;

// The panel everything sits on: dark anodised metal, brushed along its length, lit from above,
// which lifts for a moment on every kick.
[SkEffect("plate")]
[SkDoc("a brushed metal panel lit from above")]
struct Plate : IEffect
{
    // When the last kick sounded, on the effect clock.
    [SkAnimatedFor(0.35)] [SkDefault("-1000")]
    float kick;

    [SkColor] [SkDefault("#ffb45c")]
    float4 tint;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        float2 uv = input.local;
        float3 metal = lerp(float3(0.105, 0.095, 0.088), float3(0.06, 0.055, 0.052), uv.y);
        if (quality < 1.5)
        {
            // The brushing: noise stretched a hundred times along x.
            float grain = sk_value_noise(float2(input.px.x * 0.012, input.px.y * 1.3) / input.scale);
            metal *= 0.92 + 0.16 * grain;
            // A wide sheen from the light above the panel.
            float sheen = exp(-pow((uv.y - 0.08) * 5.0, 2.0)) * (0.6 + 0.4 * sin(uv.x * 3.1));
            metal += float3(1.0, 0.97, 0.93) * sheen * 0.035;
        }
        float pulse = exp(-max(input.time - kick, 0.0) * 12.0);
        metal += tint.rgb * pulse * 0.03 * (1.0 - uv.y);
        float2 c = uv - 0.5;
        metal *= 1.0 - dot(c, c) * 0.55;
        return float4(metal, 1.0);
    }
};
