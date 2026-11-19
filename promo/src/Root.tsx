import { Composition } from "remotion";
import { MadridSeEnciende, DURATION } from "./MadridSeEnciende";

export const RemotionRoot = () => (
  <Composition id="MadridSeEnciende" component={MadridSeEnciende} durationInFrames={DURATION} fps={30} width={1080} height={1920} />
);
