/**
 * Picks an existing swing video from the device photo library and normalises it into the
 * same shape the live-capture flow produces, so an imported clip can ride the exact same
 * review → upload → analysis pipeline a recording does.
 *
 * Plain async functions (no React state), mirroring `services/analysis.ts`, so this is
 * callable from both the Home and capture screens.
 */
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

/** A library clip, normalised to the capture screen's `Captured` shape plus upload hints. */
export interface PickedVideo {
  uri: string;
  /** Seconds. 0 when the picker couldn't report a duration (e.g. some Android providers). */
  durationSec: number;
  /** Bytes, or null when neither the picker nor the filesystem could size the file. */
  sizeBytes: number | null;
  /** File extension for the R2 object key, e.g. 'mp4' | 'mov'. */
  ext: string;
  /** MIME type for the upload PUT, e.g. 'video/mp4' | 'video/quicktime'. */
  contentType: string;
  width: number | null;
  height: number | null;
}

export type PickResult =
  | { status: 'picked'; video: PickedVideo }
  | { status: 'canceled' }
  | { status: 'denied'; canAskAgain: boolean };

/**
 * Request library access, open the picker for a single video, and return a normalised result.
 * Never throws on the ordinary canceled / denied paths — callers branch on `status`.
 */
export async function pickSwingVideo(): Promise<PickResult> {
  // Ask up front so the OS dialog appears before the picker, not after a selection.
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    // iOS "limited" access still reports granted:true and the picker works, so this only
    // catches a real denial.
    return { status: 'denied', canAskAgain: perm.canAskAgain };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    // No client-side trim/re-encode: keep the original (Passthrough) so the worker gets a
    // pristine source. The backend normalises length/fps.
    allowsEditing: false,
    // iOS-only: pull the clip down from iCloud if it's been offloaded from the device.
    // The default Passthrough preset reads the asset resource directly and won't fetch
    // over the network without this, so iCloud clips fail with PHPhotosErrorDomain 3164.
    shouldDownloadFromNetwork: true,
  });

  if (result.canceled || !result.assets?.length) {
    return { status: 'canceled' };
  }

  const asset = result.assets[0];
  const { ext, contentType } = deriveTypes(asset);

  return {
    status: 'picked',
    video: {
      uri: asset.uri,
      durationSec: asset.duration != null ? asset.duration / 1000 : 0,
      sizeBytes: resolveSize(asset),
      ext,
      contentType,
      width: asset.width || null,
      height: asset.height || null,
    },
  };
}

/** Prefer the picker's reported size; fall back to stat-ing the local file; else null. */
function resolveSize(asset: ImagePicker.ImagePickerAsset): number | null {
  if (typeof asset.fileSize === 'number') return asset.fileSize;
  try {
    return new File(asset.uri).size ?? null;
  } catch {
    return null;
  }
}

/**
 * Work out the object-key extension and upload content type. Prefer the asset's MIME type,
 * then the filename/URI extension, and fall back to mp4 (the most common library format).
 */
function deriveTypes(asset: ImagePicker.ImagePickerAsset): { ext: string; contentType: string } {
  const mime = asset.mimeType?.toLowerCase();
  if (mime === 'video/quicktime') return { ext: 'mov', contentType: 'video/quicktime' };
  if (mime === 'video/mp4') return { ext: 'mp4', contentType: 'video/mp4' };

  const ext = extensionOf(asset.fileName) ?? extensionOf(asset.uri);
  if (mime?.startsWith('video/')) {
    return { ext: ext ?? mime.slice('video/'.length), contentType: mime };
  }
  if (ext) {
    return { ext, contentType: ext === 'mov' ? 'video/quicktime' : `video/${ext}` };
  }
  return { ext: 'mp4', contentType: 'video/mp4' };
}

/** Lowercased extension parsed from a filename or URI, or null. Strips any query string. */
function extensionOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}
