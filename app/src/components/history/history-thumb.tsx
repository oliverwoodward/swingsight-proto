/**
 * History thumbnail (spec §11.2 item 7) — a tiny Skia skeleton drawn from the worker's
 * MEASURED pose at a representative keyframe (`top` if available). It's the product's
 * signature visual, uses only real stored keypoints (no R2 round-trip, no fabrication),
 * and degrades to a quiet view-coded tile when a pose isn't available (non-complete
 * swings, or keypoints not yet fetched).
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { fetchPoseThumbnail } from '@/services/analysis';
import { getSupabase } from '@/services/supabase';
import {
  computeContainFit,
  type AnalysisStatus,
  type Keypoint,
  type KeypointSeries,
  projectPoint,
  SKELETON_EDGES,
  type SwingView,
} from '@/domain';

const W = 56;
const H = 74;
const VIS_MIN = 0.2;

interface Pose {
  landmarks: Keypoint[];
  videoWidth: number;
  videoHeight: number;
}

export function HistoryThumb({
  analysisId,
  keypointsMeta,
  view,
  status,
}: {
  analysisId: string;
  keypointsMeta: Pick<KeypointSeries, 'videoWidth' | 'videoHeight'> | null;
  view: SwingView;
  status: AnalysisStatus;
}) {
  const [pose, setPose] = useState<Pose | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || status !== 'complete' || !keypointsMeta) return;
    let cancelled = false;
    fetchPoseThumbnail(supabase, analysisId, keypointsMeta)
      .then((p) => {
        if (!cancelled && p) setPose(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [analysisId, keypointsMeta, status]);

  const skeleton = useMemo(() => {
    if (!pose) return null;
    const fit = computeContainFit(pose.videoWidth, pose.videoHeight, W, H);
    const path = Skia.Path.Make();
    for (const [a, b] of SKELETON_EDGES) {
      const pa = pose.landmarks[a];
      const pb = pose.landmarks[b];
      if (!pa || !pb || pa.visibility < VIS_MIN || pb.visibility < VIS_MIN) continue;
      const A = projectPoint(pa.x, pa.y, fit);
      const B = projectPoint(pb.x, pb.y, fit);
      path.moveTo(A.x, A.y);
      path.lineTo(B.x, B.y);
    }
    return path;
  }, [pose]);

  return (
    <View style={styles.box}>
      {skeleton ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path
            path={skeleton}
            style="stroke"
            strokeWidth={1.6}
            strokeCap="round"
            strokeJoin="round"
            color={Brand.skeletonJoint}
          />
        </Canvas>
      ) : (
        <ThemedText style={styles.glyph}>{view === 'face_on' ? '☻' : '↗'}</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: W,
    height: H,
    borderRadius: 10,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: { color: 'rgba(255,255,255,0.45)', fontSize: 22 },
});
