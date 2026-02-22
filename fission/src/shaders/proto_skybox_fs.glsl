uniform float rColor;
uniform float gColor;
uniform float bColor;

varying vec3 vPosition;

void main() {
    float y = dot(vec3(0, 1, 0), normalize(vPosition));
    float value = smoothstep(-0.5, 0.3, y);
    vec3 color = mix(vec3(0.471, 0.514, 0.620), vec3(0.820, 0.827, 0.929), value);
    gl_FragColor = vec4(color, 1.0);
}
