import sk;

// A step button: a rubber key with a lamp under it. Off, it is a dark key with a bevel; on, the
// lamp shows through in the track's colour; when its step sounds it flares and the light spills
// onto the panel round it.
[SkEffect("pad")]
[SkDoc("a backlit rubber key that flares when its step sounds")]
struct Pad : IEffect
{
    // How far the lamp is on, 0..1.
    [SkRange(0.0, 1.0)]
    float lamp;

    // 1 while the playhead is over this step.
    [SkRange(0.0, 1.0)]
    float playing;

    // When this step last sounded, on the effect clock.
    [SkAnimatedFor(0.45)] [SkDefault("-1000")]
    float hit;

    [SkColor] [SkDefault("#ffb45c")]
    float4 tint;

    // How far the light spills outside the key.
    [SkLength] [SkBleed] [SkDefault("10")]
    float spill;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        float px = input.scale;
        float inside = input.aa(input.sd);
        float depth = max(-input.sd, 0.0);
        float flare = exp(-max(input.time - hit, 0.0) * 9.0);
        float glow = saturate(lamp * (0.75 + 0.6 * flare));

        // The key: darker at the bottom, with a lit edge along the top and a shadowed one below.
        float tilt = input.local.y;
        float3 key = lerp(float3(0.16, 0.15, 0.14), float3(0.08, 0.075, 0.07), saturate(tilt));
        float edge = smoothstep(2.5 * px, 0.0, depth);
        key += float3(1.0, 1.0, 1.0) * edge * lerp(0.16, -0.04, saturate(tilt));

        // The lamp, brightest in the middle of the key.
        float2 c = (input.local - 0.5) * 2.0;
        float core = saturate(1.0 - dot(c, c) * 0.45);
        float3 lit = lerp(tint.rgb, float3(1.0, 1.0, 1.0), 0.18 * core + 0.5 * flare * core);
        float3 face = lerp(key, lit * (0.68 + 0.42 * core), glow);

        if (quality < 1.5)
        {
            // Glass on the cap: a band of reflection across the upper third.
            float band = smoothstep(0.42, 0.1, tilt) * smoothstep(0.0, 3.0 * px, depth);
            face += float3(1.0, 1.0, 1.0) * band * (0.035 + 0.1 * glow);
        }

        // The playhead is a bright ring just inside the edge.
        float ring = smoothstep(3.0 * px, 1.5 * px, depth) * playing;
        face = lerp(face, float3(1.0, 1.0, 1.0), ring * 0.85);
        float4 colour = float4(face * inside, inside);
        if (quality >= 1.5)
            return colour;

        // The spill on the panel, outside the key.
        float outside = max(input.sd, 0.0);
        float halo = exp(-outside / (spill * 0.42)) * (1.0 - inside) * glow * (0.3 + 0.5 * flare);
        return colour + float4(tint.rgb * halo, halo * 0.7);
    }
};
