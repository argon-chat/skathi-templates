// Helpers the weather effects share. A .slang file without an [SkEffect] is a module the effects
// import, not an effect of its own.
module weather;

import sk;

// A thunderstorm's lightning: x is how bright the flash is now (0..1), y where the bolt strikes
// (0..1 across the window), z the strike's seed and w its age in seconds. The schedule is a pure
// function of the effect clock, so every effect that calls it flashes in the same frame.
public float4 sky_lightning(float time, float storm)
{
    float period = 4.6;
    float cell = floor(time / period);
    float start = 0.4 + 2.6 * sk_hash12(float2(cell, 1.7));
    float age = time - cell * period - start;
    float chance = step(sk_hash12(float2(cell, 8.3)), storm * 1.15 - 0.15);
    float first = exp(-max(age, 0.0) * 10.0) * step(0.0, age);
    float second = 0.85 * exp(-max(age - 0.16, 0.0) * 7.0) * step(0.16, age);
    float third = 0.45 * exp(-max(age - 0.34, 0.0) * 6.0) * step(0.34, age) * step(0.5, sk_hash12(float2(cell, 4.1)));
    float flash = saturate(max(first, max(second, third))) * chance * saturate(storm * 1.5);
    float x = 0.12 + 0.76 * sk_hash12(float2(cell, 3.3));
    return float4(flash, x, cell, age);
}

public float ridge_noise(float x, float seed)
{
    return sk_value_noise(float2(x, seed * 13.7));
}

// `daylight`: -1 deep night, 0 on the horizon, 1 high noon.
public float day_amount(float daylight)
{
    return smoothstep(0.05, 0.7, daylight);
}

public float night_amount(float daylight)
{
    return smoothstep(-0.05, -0.55, daylight);
}

// A colour for the time of day: `dusk` round the horizon, blending to `day` and `night`.
public float3 tod(float daylight, float3 day, float3 dusk, float3 night)
{
    return lerp(lerp(dusk, day, day_amount(daylight)), night, night_amount(daylight));
}

// How much of the dawn, day, dusk and night paintings to show. Twilight is dawn while the sun
// stands in the east (`sun` below the middle of the window) and dusk in the west.
public float4 plate_weights(float daylight, float sun)
{
    float day = day_amount(daylight);
    float night = night_amount(daylight);
    float twilight = saturate(1.0 - day - night);
    float evening = smoothstep(0.4, 0.6, sun);
    return float4(twilight * (1.0 - evening), day, twilight * evening, night);
}

// Where a window pixel falls on a 1586x992 painting scaled to cover the window: a narrow window
// crops its sides, a wide one mostly its sky.
public float2 plate_uv(float2 local, float2 window)
{
    float w = window.x / max(window.y, 1.0);
    float p = 1586.0 / 992.0;
    if (w < p)
        return float2(0.5 + (local.x - 0.5) * w / p, local.y);
    return float2(local.x, 0.8 + (local.y - 0.8) * p / w);
}

public float4 blend_plates(SkTexture dawn, SkTexture day, SkTexture dusk, SkTexture night, float4 weights, float2 uv)
{
    float4 loaded = float4(dawn.loaded() ? 1.0 : 0.0, day.loaded() ? 1.0 : 0.0, dusk.loaded() ? 1.0 : 0.0, night.loaded() ? 1.0 : 0.0);
    float4 w = weights * loaded;
    float total = w.x + w.y + w.z + w.w;
    if (total < 1e-4)
        return float4(0.0, 0.0, 0.0, 0.0);
    w /= total;
    float4 c = float4(0.0, 0.0, 0.0, 0.0);
    if (w.x > 0.0)
        c += dawn.sample(uv) * w.x;
    if (w.y > 0.0)
        c += day.sample(uv) * w.y;
    if (w.z > 0.0)
        c += dusk.sample(uv) * w.z;
    if (w.w > 0.0)
        c += night.sample(uv) * w.w;
    return c;
}
