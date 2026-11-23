import sk;

// The Commit button: an accent gradient that holds a slow sheen while something is staged and glows
// past its edge, and a bright sweep across it when a commit lands.
[SkEffect("charge")]
[SkDoc("a primary button charged with a sheen and a glow, swept by light on success")]
struct Charge : IEffect
{
    // 0 idle, 1 ready to commit.
    [SkRange(0.0, 1.0)] [SkDefault("1")]
    float level;

    // When the last commit landed, on the effect clock.
    [SkAnimatedFor(0.9)] [SkDefault("-1000")]
    float landed;

    [SkColor] [SkDefault("#9488ff")]
    float4 tint;

    [SkColor] [SkDefault("#4fe0c6")]
    float4 second;

    [SkLength] [SkBleed] [SkDefault("12")]
    float glow;

    [SkAnimated] [SkDefault("1")]
    float speed;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        float inside = input.aa(input.sd);
        float2 uv = input.local;
        float3 base = lerp(tint.rgb, lerp(tint.rgb, second.rgb, 0.55), smoothstep(0.0, 1.0, uv.x));
        base = lerp(base * 0.55 + 0.25, base, level);
        base *= 1.0 + 0.12 * (0.5 - uv.y);

        float since = input.time - landed;
        float sweep = 0.0;
        if (since >= 0.0 && since < 0.9)
        {
            float at = since / 0.9 * 1.6 - 0.3;
            sweep = exp(-pow((uv.x - at - (uv.y - 0.5) * 0.3) * 6.0, 2.0)) * (1.0 - since / 0.9);
        }
        float sheen = 0.0;
        if (quality < 1.5 && level > 0.0)
        {
            float t = frac(input.time * 0.22 * speed);
            float at = t * 2.2 - 0.6;
            sheen = exp(-pow((uv.x - at - (uv.y - 0.5) * 0.4) * 9.0, 2.0)) * 0.22 * level;
        }
        float3 face = base + float3(1.0, 1.0, 1.0) * (sheen + sweep * 0.7);
        float4 colour = float4(face * inside, inside);

        float outside = max(input.sd, 0.0) / input.scale;
        float pulse = quality < 1.5 ? 0.75 + 0.25 * sin(input.time * 2.2 * speed) : 0.85;
        float halo = exp(-outside / max(glow * 0.35, 0.5)) * (1.0 - inside) * (0.28 * level * pulse + sweep * 0.6);
        return colour + float4(lerp(tint.rgb, second.rgb, uv.x) * halo, halo);
    }
};
