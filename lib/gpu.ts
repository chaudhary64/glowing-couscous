const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

let gpu: boolean | undefined;
/**
 * WebGL on real graphics hardware, asked once per page (creating contexts to probe is
 * not free). `failIfMajorPerformanceCaveat` makes the browser refuse a context it would
 * have to emulate in software; the renderer string catches the browsers that hand one
 * out anyway. Every 3D scene on the site gates on this: in software a scene runs at
 * about 1 fps and blocks the page's main thread for seconds.
 */
export function hasGpuWebGL(): boolean {
  if (gpu === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
      if (!gl) {
        gpu = false;
      } else {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
        gpu = !SOFTWARE.test(renderer);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch {
      gpu = false;
    }
  }
  return gpu;
}
