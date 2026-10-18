import { NextResponse } from 'next/server';
import fs from 'fs';
import { getAssetFilePath, listBusinessAssets } from '@/lib/assets/storage';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const filename = searchParams.get('filename');

    let targetFilename = filename;
    let mimeType = 'application/octet-stream';

    if (id) {
      const assets = listBusinessAssets();
      const asset = assets.find(a => a.id === id);
      if (asset) {
        targetFilename = asset.filename;
        mimeType = asset.mimeType || 'application/octet-stream';
      }
    }

    if (!targetFilename) {
      return NextResponse.json({ success: false, error: 'File not specified' }, { status: 400 });
    }

    const filePath = getAssetFilePath(targetFilename);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${targetFilename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('Asset file serve error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
