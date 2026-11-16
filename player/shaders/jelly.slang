import sk;

// Candy glass for panels: the backdrop blurred, bent at the rounded rim, tinted, and lit along the edge by a
// thin pastel rainbow that shifts round the panel.
[SkEffect("jelly")]
[SkDoc("blurred candy glass with a refracting rim and a pastel rainbow edge")]
[SkBackdrop]
struct Jelly : IEffect
{
    [SkLength] [SkBackdropRadius] [SkDefault("16")] [SkRange(0.0, 25.0)]
    float blur;

    // How far the rim reaches past the edge for what it shows.
    [SkLength] [SkDefault("14")] [SkRange(0.0, 96.0)]
    float depth;

    [SkLength] [SkDefault("22")] [SkRange(1.0, 256.0)]
    float bevel;

    [SkColor] [SkDefault("#211f2a99")]
    float4 tint;

    float4 shade(EffectInput input)
    {
        float2 gradient = float2(ddx(input.sd), ddy(input.sd));
        float2 normal = gradient / max(length(gradient), 1e-4);
        float edge = 1.0 - saturate(-input.sd / max(bevel, 1.0));
        float curve = edge * edge;

        float2 shift = normal * depth * curve;
        float r = input.backdropAtPx(input.px + shift * 1.12).r;
        float4 g = input.backdropAtPx(input.px + shift);
        float b = input.backdropAtPx(input.px + shift * 0.88).b;
        float4 glass = sk_over(float4(r, g.g, b, g.a), sk_premultiply(tint));

        float px = input.scale;
        float edgeLine = exp(-pow((input.sd + 0.8 * px) / (0.7 * px), 2.0));
        float around = dot(input.local, float2(0.7, 0.45));
        float3 rainbow = sk_palette(around, float3(0.86, 0.78, 0.92), float3(0.14, 0.14, 0.1), float3(1.0, 1.0, 1.0), float3(0.0, 0.33, 0.67));
        float facing = dot(normal, float2(-0.6, -0.8));
        float rim = edgeLine * (0.1 + 0.22 * saturate(facing));
        float sheen = 0.035 * saturate(1.0 - input.local.y * 2.2) * (1.0 - edge);
        float3 light = rainbow * rim + sheen;
        return float4(glass.rgb + light, saturate(glass.a + max(rim, sheen) * (1.0 - glass.a)));
    }
};
