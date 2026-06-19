declare module "imagetracerjs" {
  type ImageTracerColor = {
    r: number;
    g: number;
    b: number;
    a: number;
  };

  type ImageTracerOptions = {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    colorsampling?: number;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    scale?: number;
    roundcoords?: number;
    linefilter?: boolean;
    strokewidth?: number;
    pal?: ImageTracerColor[];
  };

  const ImageTracer: {
    imagedataToSVG(
      imageData: ImageData,
      options?: ImageTracerOptions | string,
    ): string;
  };

  export default ImageTracer;
}
