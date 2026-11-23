import sk;

// The quiet material behind the welcome and empty states: two soft lights drifting over the pane with a
// fine grain, transparent enough to sit on the window material.
[SkEffect("field")]
[SkDoc("two soft drifting lights and a fine grain, for empty states")]
struct Field : IEffect
{
    [SkColor] [SkDefault("#9488ff")]
    float4 first;

    [SkColor] [SkDefault("#4fe0c6")]
    float4 second;

    [SkRange(0.0, 1.0)] [SkDefault("0.5")]
    float strength;

    [SkAnimated] [SkDefault("1")]
    float speed;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        float t = quality >= 1.5 ? 0.0 : input.time * 0.07 * speed;
        float2 p = input.centered();
        float2 a = p - float2(-0.55 + 0.25 * sin(t * 1.3), -0.35 + 0.2 * cos(t * 1.1));
        float2 b = p - float2(0.6 + 0.2 * cos(t * 0.9), 0.4 + 0.25 * sin(t * 1.4));
        float la = exp(-dot(a, a) * 1.5);
        float lb = exp(-dot(b, b) * 1.8);
        float3 rgb = first.rgb * la + second.rgb * lb;
        float alpha = (la * 0.55 + lb * 0.45) * strength;
        if (quality < 0.5)
        {
            float n = sk_fbm(p * 2.2 + float2(t * 0.6, -t * 0.4));
            alpha *= 0.8 + 0.4 * n;
        }
        if (quality < 1.5)
        {
            float grain = sk_hash12(floor(input.px / input.scale)) - 0.5;
            alpha = max(alpha + grain * 0.025 * strength, 0.0);
        }
        return float4(rgb * alpha, alpha);
    }
};
