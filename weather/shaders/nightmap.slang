import sk;

// Recolours the street-map tiles painted inside the element into the app's night palette: land a
// deep violet, water darker still, borders, coasts and roads drawn in light. Where no tile has
// loaded (offline, or still loading) it draws a made-up coastline instead, so the card never sits
// empty.
[SkEffect("nightmap")]
[SkDoc("grades a street map into a dark violet night map")]
[SkContent]
struct NightMap : IEffect
{
    [SkColor] [SkDefault("#231a4a")]
    float4 land;

    [SkColor] [SkDefault("#120d2c")]
    float4 water;

    [SkColor] [SkDefault("#a99cff")]
    float4 lines;

    static override bool straightAlpha() { return true; }

    float4 shade(EffectInput input)
    {
        float4 c = input.content;
        float3 rgb = c.rgb / max(c.a, 1e-3);
        float l = sk_luma(rgb);
        float wet = smoothstep(0.02, 0.08, rgb.b - rgb.r) * smoothstep(0.55, 0.75, l);
        float ink = saturate((0.93 - l) * 3.2) * (1.0 - wet);
        float3 graded = lerp(land.rgb, water.rgb, wet);
        graded = lerp(graded, lines.rgb, ink * 0.5);

        float2 q = input.px / (90.0 * input.scale);
        float shape = sk_fbm(q * 0.9 + 3.0) + 0.25 * sk_fbm(q * 4.0);
        float isLand = smoothstep(0.52, 0.55, shape);
        float coast = 1.0 - smoothstep(0.0, 0.025, abs(shape - 0.535));
        float2 grid = abs(frac(input.px / (64.0 * input.scale)) - 0.5);
        float graticule = 1.0 - smoothstep(0.0, 0.02, min(grid.x, grid.y));
        float3 madeUp = lerp(water.rgb, land.rgb, isLand);
        madeUp = lerp(madeUp, lines.rgb, coast * 0.6 + graticule * 0.08);

        return float4(lerp(madeUp, graded, smoothstep(0.2, 0.9, c.a)), 1.0);
    }
};
