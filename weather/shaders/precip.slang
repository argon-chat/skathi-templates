import sk;
import weather;

// What falls between the sky and the glass: rain in slanted streaks and snow in drifting flakes,
// each in layers, the nearer ones bigger, softer and faster. Both amounts are numbers, so a CSS
// transition turns rain into snow by thinning one while the other thickens.
[SkEffect("precip")]
[SkDoc("layered rain streaks and snowflakes, slanted by the wind")]
struct Precip : IEffect
{
    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float rain;

    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float snow;

    // -1 blows to the left, 1 to the right.
    [SkDefault("0.2")] [SkRange(-1.0, 1.0)]
    float wind;

    // Lights the drops when lightning flashes.
    [SkDefault("0")] [SkRange(0.0, 1.0)]
    float storm;

    [SkAnimated] [SkDefault("1")] [SkRange(0.0, 4.0)]
    float speed;

    static override bool straightAlpha() { return true; }

    float streaks(EffectInput input, float t)
    {
        float s = input.scale;
        float alpha = 0.0;
        for (int layer = 0; layer < 4; layer++)
        {
            float depth = float(layer) / 3.0;
            float cell = (9.0 + 15.0 * depth) * s;
            float len = (14.0 + 46.0 * depth) * s;
            float fall = (900.0 + 1100.0 * depth) * s;
            float2 q = sk_rotate(input.px, wind * 0.28 * (0.7 + 0.3 * depth));
            float column = floor(q.x / cell);
            float hc = sk_hash12(float2(column, 3.0 + depth * 17.0));
            float y = q.y - t * fall * (0.85 + 0.3 * hc) + hc * 977.0;
            float period = len * (3.0 + 4.0 * sk_hash12(float2(column, 9.0)));
            float row = floor(y / period);
            float local = y - row * period;
            float present = step(sk_hash12(float2(column, row + depth * 31.0)), rain * (0.55 + 0.25 * depth));
            float centre = (column + 0.5 + 0.6 * (sk_hash12(float2(column, row + 5.0)) - 0.5)) * cell;
            float width = (0.45 + 0.9 * depth) * s;
            float across = 1.0 - smoothstep(width * 0.4, width + 0.6 * s, abs(q.x - centre));
            float head = smoothstep(0.0, len * 0.25, local) * (1.0 - smoothstep(len * 0.55, len, local));
            alpha = max(alpha, across * head * present * (0.16 + 0.30 * depth));
        }
        return alpha;
    }

    float flakes(EffectInput input, float t)
    {
        float s = input.scale;
        float alpha = 0.0;
        for (int layer = 0; layer < 5; layer++)
        {
            float depth = float(layer) / 4.0;
            float cell = (34.0 + 46.0 * depth) * s;
            float fall = (22.0 + 48.0 * depth) * s;
            float2 q = input.px - float2(t * wind * fall * 1.4, t * fall);
            float2 id = floor(q / cell) + float(layer) * 23.0;
            float2 jitter = sk_hash22(id);
            float2 spot = (floor(q / cell) + 0.2 + 0.6 * jitter) * cell;
            spot.x += sin(t * (0.6 + jitter.y * 0.8) + jitter.x * 6.28) * cell * 0.22;
            float radius = (0.9 + 2.2 * depth + jitter.y * 1.2) * s;
            float soft = (0.5 + 2.2 * depth * depth) * s;
            float flake = 1.0 - smoothstep(radius - soft, radius + soft, length(q - spot));
            float present = step(sk_hash12(id + 5.0), snow * (0.5 + 0.4 * (1.0 - depth)));
            alpha = max(alpha, flake * present * (0.55 + 0.35 * (1.0 - depth * 0.6)));
        }
        return alpha;
    }

    float4 shade(EffectInput input)
    {
        float t = input.time * speed;
        float r = rain > 0.001 ? streaks(input, t) : 0.0;
        float f = snow > 0.001 ? flakes(input, t) : 0.0;
        float flash = sky_lightning(input.time, storm).x;

        float sheet = rain * rain * 0.10 * smoothstep(0.1, 1.0, input.local.y);
        float alpha = saturate(max(r * (1.0 + flash * 1.5), f) + sheet * (1.0 - r));
        float3 rgb = lerp(float3(0.80, 0.78, 0.98), float3(0.98, 0.97, 1.0), saturate(f * 2.0 + flash));
        return float4(rgb, alpha);
    }
};
