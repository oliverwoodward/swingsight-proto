import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

type CapturePreviewProps = {
  uri: string;
};

/**
 * Loops the just-captured clip in the review step so the golfer can confirm the
 * recording before doing anything with it. Mounted only while reviewing, so the
 * player is created with the final URI (no source-swapping needed).
 */
export function CapturePreview({ uri }: CapturePreviewProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}
