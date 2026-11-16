import sk;

// A burst of candy hearts floating up from a point, drawn over the whole window. `born` is when the burst
// started on the effect clock (`performance.now() / 1000`), so the page sets it once per like and the window
// repaints only while the hearts are in the air.
[SkEffect("hearts")]
[SkDoc("a burst of pastel hearts rising from a point")]
struct Hearts : IEffect
{
    // Where the burst starts, 0..1 across the element.
    [SkDefault("0.5 0.5")]
    float2 origin;

    [SkAnimatedFor(2.6)] [SkDefault("-1000")]
    float born;

    static override bool straightAlpha() { return true; }

    // Inigo Quilez's heart: point at the origin, lobes up to y = 1.
    float heart(float2 p)
    {
        p.x = abs(p.x);
        if (p.y + p.x > 1.0)
            return length(p - float2(0.25, 0.75)) - 0.35355339;
        float2 a = p - float2(0.0, 1.0);
        float2 b = p - 0.5 * max(p.x + p.y, 0.0);
        return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
    }

    float3 candy(float h)
    {
        return h < 0.3 ? float3(0.969, 0.659, 0.816)
            : h < 0.55 ? float3(0.788, 0.655, 0.961)
            : h < 0.8 ? float3(0.624, 0.804, 0.961)
            : float3(0.984, 0.878, 0.627);
    }

    float4 shade(EffectInput input)
    {
        float age = input.time - born;
        if (age < 0.0 || age > 2.6)
            return float4(0.0, 0.0, 0.0, 0.0);
        float px = input.scale;
        float2 from = origin * input.size;
        float4 colour = float4(0.0, 0.0, 0.0, 0.0);
        for (int i = 0; i < 16; i++)
        {
            float2 h = sk_hash22(float2(float(i), 7.3));
            float2 k = sk_hash22(float2(float(i), 1.9));
            float delay = h.y * 0.35;
            float life = saturate((age - delay) / 2.2);
            if (life <= 0.0 || life >= 1.0)
                continue;
            float spread = (h.x - 0.5) * 2.0;
            float2 at = from + float2(
                spread * 150.0 * px * sqrt(life) + sin(life * 9.0 + k.x * 6.28) * 12.0 * px,
                -(60.0 + 200.0 * k.y) * px * life);
            float size = (12.0 + 12.0 * k.x) * px * smoothstep(0.0, 0.15, life);
            float2 p = (input.px - at) / max(size, 1e-3);
            p = sk_rotate(p, spread * 0.4 * life);
            float d = heart(float2(p.x, 0.55 - p.y)) * size;
            float fade = 1.0 - smoothstep(0.6, 1.0, life);
            float body = input.aa(d) * fade;
            float glow = exp(-max(d, 0.0) / (5.0 * px)) * 0.35 * fade;
            float3 tint = candy(k.x * 0.6 + h.x * 0.4);
            float shine = smoothstep(0.35, 0.0, length(p - float2(-0.28, -0.12)));
            float a = max(body, glow);
            float3 rgb = lerp(tint, float3(1.0, 1.0, 1.0), shine * 0.6 * body);
            colour = float4(lerp(colour.rgb, rgb, a), max(colour.a, a));
        }
        return colour;
    }
};
