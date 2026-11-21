import sk;

// The level meter above the grid: sixteen bars from the analyser, bass on the left, over a floor
// that flashes on every kick.
//
// It draws three levels of detail and the host picks one from CPU pressure, the power mode and the
// battery: bars with a bloom and a grain, bars with a bloom, or flat bars.
[SkEffect("meter")]
[SkDoc("sixteen level bars with a bloom and a kick flash, in three levels of detail")]
struct Meter : IEffect
{
    // Band levels 0..1, four per argument group, bass first.
    float4 bands0;
    float4 bands1;
    float4 bands2;
    float4 bands3;

    // When the last kick sounded, on the effect clock.
    [SkAnimatedFor(0.5)] [SkDefault("-1000")]
    float kick;

    [SkColor] [SkDefault("#ffb45c")]
    float4 accent;

    [SkQuality]
    float quality;

    static const int BANDS = 16;

    float level(int j)
    {
        float4 groups[4] = { bands0, bands1, bands2, bands3 };
        int c = clamp(j, 0, BANDS - 1);
        float4 g = groups[c / 4];
        int k = c % 4;
        return k == 0 ? g.x : k == 1 ? g.y : k == 2 ? g.z : g.w;
    }

    float4 shade(EffectInput input)
    {
        float2 uv = input.px / input.size;
        float x = uv.x * float(BANDS);
        int band = min(int(x), BANDS - 1);
        float height = level(band);
        float up = 1.0 - uv.y;

        // A bar is the middle 70% of its slot, in steps like an LED ladder.
        float across = abs(frac(x) - 0.5);
        float rung = frac(up * 14.0) < 0.72 ? 1.0 : 0.0;
        float body = (across < 0.35 ? 1.0 : 0.0) * (up < height ? 1.0 : 0.0) * rung;
        float3 hot = lerp(accent.rgb, float3(1.0, 0.96, 0.88), saturate(up * 1.2 - 0.6));
        float4 colour = float4(hot * body, body);
        if (quality >= 1.5)
            return colour;

        // The bloom: light spills sideways and upwards from the lit part of each bar.
        float spill = exp(-max(up - height, 0.0) * 9.0) * exp(-max(across - 0.35, 0.0) * 14.0) * height * 0.45;
        float age = input.time - kick;
        float flash = age >= 0.0 && age < 0.5 ? exp(-age * 9.0) * exp(-up * 5.0) * 0.5 : 0.0;
        float glow = spill + flash;
        colour = sk_over(float4(accent.rgb * glow, glow * 0.8), colour);
        if (quality >= 0.5)
            return colour;

        float grain = sk_value_noise(input.px * 0.9 + input.time * 30.0) - 0.5;
        colour.rgb *= 1.0 + grain * 0.18;
        return colour;
    }
};
