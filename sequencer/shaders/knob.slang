import sk;

// A rotary control seen from above: a ring of ticks, an arc that fills with the value, and a dial
// under glass with a pointer mark. The element is square; the number in the middle is the page's.
//
// Three levels of detail, picked by the host: glass that catches the pointer and an arc that
// blooms, the same without the pointer's light, or flat shapes.
[SkEffect("knob")]
[SkDoc("a dial with a value arc and a ring of ticks, lit like glass")]
struct Knob : IEffect
{
    [SkRange(0.0, 1.0)]
    float value;

    [SkColor] [SkDefault("#ffb45c")]
    float4 accent;

    // When the value last changed, on the effect clock: the arc flares for a moment.
    [SkAnimatedFor(0.6)] [SkDefault("-1000")]
    float touched;

    [SkPointer]
    float2 pointer;

    [SkQuality]
    float quality;

    static const float PI = 3.14159265359;
    // The scale leaves the bottom quarter open, like the dial of a meter.
    static const float SWEEP = 1.5 * PI;
    static const int TICKS = 31;

    // 0 at the start of the scale (bottom left), 1 at its end (bottom right), clockwise over the top.
    float along(float2 v)
    {
        float a = atan2(v.y, v.x) - 0.75 * PI;
        if (a < 0.0)
            a += 2.0 * PI;
        return a / SWEEP;
    }

    float2 at(float t, float radius)
    {
        float a = 0.75 * PI + t * SWEEP;
        return float2(cos(a), sin(a)) * radius;
    }

    // Distance to the arc from `from` to `to` along the scale, with round ends.
    float arc(float2 v, float radius, float from, float to)
    {
        float t = along(v);
        if (t >= from && t <= to)
            return abs(length(v) - radius);
        return min(length(v - at(from, radius)), length(v - at(to, radius)));
    }

    float4 shade(EffectInput input)
    {
        float2 v = input.px - input.size * 0.5;
        float R = min(input.size.x, input.size.y) * 0.5;
        float r = length(v);
        float t = along(v);
        float px = input.scale;
        float4 colour = float4(0.0, 0.0, 0.0, 0.0);

        // The ticks: lit up to the value, dim past it.
        if (t <= 1.0 + 0.5 / float(TICKS))
        {
            float slot = t * float(TICKS - 1);
            float nearest = round(slot);
            float across = abs(slot - nearest) / float(TICKS - 1) * SWEEP * r;
            float inRing = smoothstep(0.86 * R - px, 0.86 * R, r) * smoothstep(0.97 * R + px, 0.97 * R, r);
            float tick = smoothstep(0.9 * px, 0.3 * px, across) * inRing;
            float lit = nearest / float(TICKS - 1) <= value + 0.001 ? 0.75 : 0.18;
            colour += float4(float3(1.0, 1.0, 1.0) * tick * lit, tick * lit);
        }

        // The track and the arc on it.
        float thick = 0.045 * R;
        float track = input.aa(arc(v, 0.72 * R, 0.0, 1.0) - thick);
        colour = sk_over(colour, float4(float3(1.0, 1.0, 1.0) * 0.07 * track, 0.5 * track));
        float d = arc(v, 0.72 * R, 0.0, max(value, 0.001)) - thick;
        float flare = exp(-max(input.time - touched, 0.0) * 6.0);
        float3 hot = lerp(float3(0.95, 0.95, 0.95), accent.rgb, 0.4 + 0.45 * flare);
        if (quality < 1.5 && value > 0.001)
        {
            float bloom = exp(-max(d, 0.0) / (0.09 * R)) * (0.22 + 0.5 * flare);
            colour += float4(accent.rgb * bloom, bloom * 0.6);
        }
        float body = value > 0.001 ? input.aa(d) : 0.0;
        colour = sk_over(colour, float4(hot * body, body));

        // The dial: a dark dome, lighter towards the top left, with a rim that catches the light.
        float dial = 0.56 * R;
        float disc = input.aa(r - dial);
        float2 n = v / max(dial, 1.0);
        float dome = saturate(0.5 - 0.5 * dot(n, normalize(float2(0.5, 0.86))));
        float3 face = lerp(float3(0.045, 0.045, 0.05), float3(0.15, 0.15, 0.165), dome * dome);
        float rim = smoothstep(dial - 3.0 * px, dial - 0.5 * px, r) * (0.1 + 0.45 * dome);
        face += float3(1.0, 1.0, 1.0) * rim;
        colour = sk_over(colour, float4(face * disc, disc));

        // The mark near the rim that turns with the value.
        float2 dir = at(value, 1.0);
        float reach = clamp(dot(v, dir), 0.36 * R, 0.5 * R);
        float mark = input.aa(length(v - dir * reach) - 0.022 * R);
        colour = sk_over(colour, float4(float3(0.96, 0.96, 0.96) * mark, mark));
        if (quality >= 0.5)
            return colour;

        // Glass over the dial: a soft light that follows the pointer.
        float2 light = (pointer - 0.5) * input.size;
        float gloss = exp(-dot(v - light * 0.35, v - light * 0.35) / (0.5 * dial * dial)) * 0.1;
        colour.rgb += float3(1.0, 1.0, 1.0) * gloss * disc;
        return colour;
    }
};
