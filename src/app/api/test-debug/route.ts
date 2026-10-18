import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const cwd = process.cwd();
    const storePath = path.join(cwd, '.knowledge_store');
    const storeExists = fs.existsSync(storePath);
    let files: string[] = [];
    let itemsCount = -1;
    let indexFileSize = -1;

    if (storeExists) {
      files = fs.readdirSync(storePath);
      const indexPath = path.join(storePath, 'index.json');
      if (fs.existsSync(indexPath)) {
        const stat = fs.statSync(indexPath);
        indexFileSize = stat.size;
        try {
          const raw = fs.readFileSync(indexPath, 'utf8');
          const parsed = JSON.parse(raw);
          itemsCount = Array.isArray(parsed?.items) ? parsed.items.length : -2;
        } catch (e: any) {
          itemsCount = -999;
        }
      }
    }

    return NextResponse.json({
      status: 'ok',
      cwd,
      storePath,
      storeExists,
      files,
      indexFileSize,
      itemsCount,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: 'error',
      message: err?.message,
      stack: err?.stack,
    }, { status: 500 });
  }
}
