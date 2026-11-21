import sk;

// The glass in front of the framebuffer. It reads the element's own painting, the canvas, and shows it
// as a picture tube would: bulged towards the viewer, one dark gap between each of the `rows` lines,
// dimmer in the corners, with the room's light on the glass.
//
// Three levels of detail, picked by the host from CPU pressure, the power mode and the battery: all of
// it, the same without the bulge, or the canvas as it is.
[SkEffect("crt")]
[SkDoc("a picture tube over the element's painting: a bulge, scanlines and a vignette")]
[SkContent]
struct Crt : IEffect
{
    [SkDefault("200")] [SkRange(1.0, 2000.0)]
    float rows;

    [SkDefault("0.6")] [SkRange(0.0, 1.0)]
    float amount;

    [SkQuality]
    float quality;

    float4 shade(EffectInput input)
    {
        if (quality >= 1.5)
            return input.content;

        float2 c = input.local - 0.5;
        // The middle of each edge stays where it is and the corners are pushed off the glass.
        float k = quality < 0.5 ? 0.16 * amount : 0.0;
        float2 bent = c * (1.0 + k * dot(c, c)) / (1.0 + k * 0.25);
        float2 margin = (0.5 - abs(bent)) * input.size;
        float inside = saturate(min(margin.x, margin.y) + 0.5);
        float3 rgb = input.contentAtPx((bent + 0.5) * input.size).rgb;

        // Rows thinner than three device pixels would shimmer instead of reading as lines.
        float visible = saturate(input.size.y / rows / 1.5 - 1.0);
        float gap = 0.5 - 0.5 * cos(6.2831853 * (bent.y + 0.5) * rows);
        rgb *= 1.0 + amount * visible * (0.1 - 0.34 * (1.0 - gap));

        rgb *= 1.0 - amount * 0.7 * dot(c, c);
        float2 lamp = c - float2(-0.2, -0.34);
        rgb += float3(0.9, 0.95, 1.0) * exp(-dot(lamp, lamp) * 9.0) * 0.035 * amount;
        return float4(rgb * inside, 1.0);
    }
};
