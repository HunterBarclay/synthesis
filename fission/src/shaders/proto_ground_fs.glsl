uniform float rColor;
uniform float gColor;
uniform float bColor;

uniform float crossStep;
uniform float crossLineWidth;
uniform float crossLineLength;
uniform float fadeInnerRadius;
uniform float fadeOuterRadius;
uniform vec3 focusPoint;

varying vec3 vPosition;

float lineXCheck(vec2 point, float lineWidth, float lineLength) {
    float onLine = step(0.5 - lineWidth / 2.0, point.y)
        * (1.0 - step(0.5 + lineWidth / 2.0, point.y));
    float withinBounds = step(0.5 - lineLength / 2.0, point.x)
        * (1.0 - step(0.5 + lineLength / 2.0, point.x));
    return onLine * withinBounds;
}

float lineZCheck(vec2 point, float lineWidth, float lineLength) {
    float onLine = step(0.5 - lineWidth / 2.0, point.x)
        * (1.0 - step(0.5 + lineWidth / 2.0, point.x));
    float withinBounds = step(0.5 - lineLength / 2.0, point.y)
        * (1.0 - step(0.5 + lineLength / 2.0, point.y));
    return onLine * withinBounds;
}

vec3 newFocusPoint() {
    float h1 = distance(focusPoint, cameraPosition);
    float a1 = abs(focusPoint.y - cameraPosition.y);
    float theta = acos(a1 / h1);
    float h2 = abs(cameraPosition.y) / cos(theta);
    float t = h2 / h1;
    return mix(cameraPosition, focusPoint, t);
}

void main() {
    vec2 point = vPosition.xz / crossStep;
    vec2 fracPoint = vec2(fract(point.x), fract(point.y));
    float withinCross = max(
        lineXCheck(fracPoint, crossLineWidth / crossStep, crossLineLength / crossStep),
        lineZCheck(fracPoint, crossLineWidth / crossStep, crossLineLength / crossStep)
    );

    float tooShallow = 1.0 - smoothstep(0.01, 0.1, abs(dot(vec3(0.0, 1.0, 0.0), focusPoint - cameraPosition)));
    vec3 adjustedFocusPoint = mix(newFocusPoint(), focusPoint, tooShallow);
    withinCross = withinCross * (1.0 - smoothstep(fadeInnerRadius, fadeOuterRadius, distance(adjustedFocusPoint.xz, vPosition.xz)));

    gl_FragColor = vec4(rColor, gColor, bColor, withinCross);
}
