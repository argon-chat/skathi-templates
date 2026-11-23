import sk;

// The bar under the title bar while git talks to a remote: a comet that runs along it and loops, since
// git does not say how far it is.
[SkEffect("progress")]
[SkDoc("an indeterminate progress line with a running comet")]
struct Progress : IEffect
{
    [SkColor] [SkDefault("#9488ff")]
    float4 tint;

    [SkColor] [SkDefault("#4fe0c6")]
    float4 second;

    [SkAnimated] [SkDefault("1")]
    float speed;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        float x = input.local.x;
        float t = frac(input.time * 0.55 * speed);
        float head = t * 1.4 - 0.2;
        float d = head - x;
        float comet = d >= 0.0 ? exp(-d * 7.0) : exp(d * 80.0);
        if (quality >= 1.5)
            comet = 0.55;
        float track = 0.18;
        float a = saturate(track + comet * 0.95);
        float3 rgb = lerp(tint.rgb, second.rgb, saturate(x + 0.2 * sin(input.time * 2.0)));
        rgb = lerp(rgb, float3(1.0, 1.0, 1.0), comet * 0.35);
        return float4(rgb * a, a);
    }
};
