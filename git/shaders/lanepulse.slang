import sk;

// A light that travels down the current branch's lane in the history graph: a bright head with a tail
// fading behind it, over a faint glow along the whole lane.
[SkEffect("lanepulse")]
[SkDoc("a light pulse travelling down a lane of the commit graph")]
struct LanePulse : IEffect
{
    [SkColor] [SkDefault("#9488ff")]
    float4 tint;

    [SkAnimated] [SkDefault("1")] [SkRange(0.0, 4.0)]
    float speed;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        float px = input.scale;
        float x = abs(input.px.x - input.size.x * 0.5) / px;
        float y = input.px.y / px;
        float core = exp(-x * x / 2.5);
        float halo = exp(-x * x / 22.0);
        float glow = halo * 0.10;
        if (quality >= 1.5)
            return float4(tint.rgb * glow, glow);

        float period = 640.0;
        float phase = frac((input.time * 120.0 * speed - y) / period);
        float comet = exp(-phase * 9.0) * step(0.0, phase);
        float lead = exp(-(1.0 - phase) * 60.0);
        float pulse = max(comet, lead);
        float light = glow + pulse * (core * 0.9 + (quality < 0.5 ? halo * 0.35 : 0.0));
        float3 rgb = lerp(tint.rgb, float3(1.0, 1.0, 1.0), core * pulse * 0.5);
        return float4(rgb * light, light);
    }
};
