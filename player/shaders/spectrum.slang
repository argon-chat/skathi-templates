import sk;

// A radial spectrum: 24 bands from bass at the top to treble at the bottom, mirrored left and right, drawn
// as a glowing flame of thin bars round the cover, with falling peak caps and a shockwave on every kick.
//
// The page hands it the raw levels every frame. Smoothing and the peak caps live in the history: each texel
// keeps the state of the band its angle falls in (red the smoothed level, green the peak, blue how long
// the peak still holds, alpha its fall speed).
[SkEffect("spectrum")]
[SkDoc("a radial flame spectrum with peak caps and kick shockwaves, smoothed in its history")]
[SkHistory]
struct Spectrum : IEffect
{
    // Band levels 0..1, four per argument group, bass first.
    float4 bands0;
    float4 bands1;
    float4 bands2;
    float4 bands3;
    float4 bands4;
    float4 bands5;

    // Radius of the circle the bars stand on.
    [SkLength] [SkDefault("128")] [SkRange(8.0, 2048.0)]
    float inner;

    // Length of a bar at full level.
    [SkLength] [SkDefault("96")] [SkRange(4.0, 1024.0)]
    float reach;

    // When the levels last changed: the ring keeps animating for a moment after, so bars and caps settle.
    [SkAnimatedFor(2.0)] [SkDefault("-1000")]
    float fed;

    // When the last kick landed, on the effect clock.
    [SkAnimatedFor(1.2)] [SkDefault("-1000")]
    float kick;

    // The colour of the track; its alpha is how far it takes over the candy gradient.
    [SkColor] [SkDefault("#f7a8d04d")]
    float4 accent;

    static const int BANDS = 24;
    static const int BARS = 56;
    static const float PI = 3.14159265359;

    float raw(int j)
    {
        float4 groups[6] = { bands0, bands1, bands2, bands3, bands4, bands5 };
        float4 g = groups[clamp(j, 0, BANDS - 1) / 4];
        int k = clamp(j, 0, BANDS - 1) % 4;
        return k == 0 ? g.x : k == 1 ? g.y : k == 2 ? g.z : g.w;
    }

    // 0 at the top of the ring, 1 at the bottom, the same on both sides.
    float around(float2 v)
    {
        return 1.0 - abs(atan2(v.x, v.y)) / PI;
    }

    float2 direction(float u, float side)
    {
        float a = side * (1.0 - u) * PI;
        return float2(sin(a), cos(a));
    }

    float2 stateOf(EffectInput input, int j)
    {
        int c = clamp(j, 0, BANDS - 1);
        float2 centre = input.size * 0.5;
        return input.historyAtPx(centre + direction((float(c) + 0.5) / float(BANDS), 1.0) * inner * 0.5).rg;
    }

    // Level and peak at `u` round the ring, a Catmull-Rom curve through the bands.
    float2 sampleAt(EffectInput input, float u)
    {
        float x = u * float(BANDS) - 0.5;
        int i = int(floor(x));
        float t = x - float(i);
        float2 p0 = stateOf(input, i - 1);
        float2 p1 = stateOf(input, i);
        float2 p2 = stateOf(input, i + 1);
        float2 p3 = stateOf(input, i + 2);
        float2 a = 2.0 * p1;
        float2 b = p2 - p0;
        float2 c = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3;
        float2 d = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
        return saturate(0.5 * (a + b * t + c * t * t + d * t * t * t));
    }

    float3 candy(float u)
    {
        float3 pink = float3(0.969, 0.659, 0.816);
        float3 lilac = float3(0.788, 0.655, 0.961);
        float3 blue = float3(0.624, 0.804, 0.961);
        float3 yellow = float3(0.984, 0.878, 0.627);
        float s = saturate(u) * 3.0;
        return s < 1.0 ? lerp(pink, lilac, s) : s < 2.0 ? lerp(lilac, blue, s - 1.0) : lerp(blue, yellow, s - 2.0);
    }

    float3 tintAt(float u)
    {
        return lerp(candy(u), accent.rgb, accent.a);
    }

    override float4 update(EffectInput input)
    {
        float2 v = input.px - input.size * 0.5;
        float level = raw(min(int(around(v) * float(BANDS)), BANDS - 1));
        float4 last = input.history;
        float eased = level > last.r ? lerp(last.r, level, 0.7) : max(level, last.r * 0.9 - 0.004);

        float peak = last.g;
        float hold = last.b - 1.0 / 24.0;
        float fall = last.a;
        if (eased >= peak)
        {
            peak = eased;
            hold = 1.0;
            fall = 0.0;
        }
        else if (hold <= 0.0)
        {
            fall += 0.0012;
            peak = max(eased, peak - fall);
        }
        return float4(eased, peak, max(hold, 0.0), fall);
    }

    float4 shade(EffectInput input)
    {
        float2 centre = input.size * 0.5;
        float2 v = input.px - centre;
        float r = length(v);
        float side = v.x < 0.0 ? -1.0 : 1.0;
        float u = around(v);
        float px = input.scale;

        float bass = 0.0;
        for (int i = 0; i < 3; i++)
            bass += stateOf(input, i).r;
        bass /= 3.0;

        float base = inner + (5.0 + 6.0 * bass) * px;
        float slot = PI * base / float(BARS);
        float w = 0.3 * slot;

        float4 colour = float4(0.0, 0.0, 0.0, 0.0);

        // The halo the bass breathes into.
        float outside = r - inner;
        float halo = smoothstep(-16.0 * px, 0.0, outside) * exp(-max(outside, 0.0) / (40.0 * px)) * (0.05 + 0.45 * bass * bass);
        colour += float4(lerp(tintAt(0.0), float3(1.0, 1.0, 1.0), 0.15) * halo, halo);

        // The flame: the spectrum's outline filled and bloomed, under the bars.
        float2 here = sampleAt(input, u);
        float edge = base + here.x * reach;
        float inFlame = smoothstep(edge + 1.5 * px, edge - 1.5 * px, r) * step(base - 2.0 * px, r);
        float depth = saturate((r - base) / max(edge - base, 1.0));
        float3 tint = tintAt(u);
        float fill = inFlame * (0.1 + 0.3 * depth * depth) * smoothstep(0.02, 0.12, here.x);
        float bloom = exp(-max(r - edge, 0.0) / (16.0 * px)) * step(base, r) * here.x * 0.55;
        colour += float4(lerp(tint, float3(1.0, 1.0, 1.0), 0.2) * (fill + bloom), fill + bloom * 0.8);

        // Thin bars, BARS per side, with a white-hot tip and a peak cap above.
        float bi = floor(u * float(BARS));
        for (int k = -1; k <= 1; k++)
        {
            float j = bi + float(k);
            if (j < 0.0 || j >= float(BARS))
                continue;
            float bu = (j + 0.5) / float(BARS);
            float2 dir = direction(bu, side);
            float2 s = sampleAt(input, bu);
            float3 bt = tintAt(bu);

            float along = dot(v, dir) - base;
            float across = v.x * dir.y - v.y * dir.x;
            float len = 2.0 * w + 1.0 * px + s.x * reach;
            float seg = clamp(along, w, max(len - w, w));
            float d = length(float2(across, along - seg)) - w;

            float tip = saturate(along / max(len, 1.0));
            float3 bar = lerp(bt, float3(1.0, 1.0, 1.0), 0.05 + 0.55 * tip * tip * tip * s.x);
            float glow = exp(-max(d, 0.0) / (5.0 * px)) * (0.08 + 0.6 * s.x);
            colour += float4(bt * glow, glow * 0.7);
            float body = input.aa(d);
            colour = sk_over(colour, float4(bar * body, body));

            float capAt = 2.0 * w + 1.0 * px + s.y * reach + 5.0 * px;
            float dc = length(float2(across, along - capAt)) - w * 0.9;
            float cap = input.aa(dc) * smoothstep(0.04, 0.12, s.y);
            float3 capTint = lerp(bt, float3(1.0, 1.0, 1.0), 0.45);
            colour = sk_over(colour, float4(capTint * cap, cap));
        }

        // A shockwave rolls out from the cover on every kick.
        float age = input.time - kick;
        if (age >= 0.0 && age < 1.2)
        {
            float p = age / 1.2;
            float at = inner + (1.0 - (1.0 - p) * (1.0 - p)) * (reach + 24.0 * px);
            float ring = exp(-pow((r - at) / ((1.5 + 5.0 * p) * px), 2.0)) * (1.0 - p) * (1.0 - p);
            colour += float4(lerp(tintAt(0.0), float3(1.0, 1.0, 1.0), 0.5) * ring, ring);
        }

        return float4(colour.rgb, saturate(colour.a));
    }
};
