package dev.mono.local;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;

/** A single shared, downsampled photographic wallpaper. Decoded on MonoApp.io. */
final class SakuraArt extends Drawable {
 private static volatile Bitmap bitmap,customBitmap;private final boolean custom;
 SakuraArt(){this(false);}
 SakuraArt(boolean custom){this.custom=custom;}
 static void custom(Bitmap image){customBitmap=image;}private final Paint paint=new Paint(Paint.FILTER_BITMAP_FLAG);private final Rect source=new Rect();private final RectF target=new RectF();
 static void prepare(Context context){
  java.io.File customFile=new java.io.File(context.getFilesDir(),"home-wallpaper.bin");if(customFile.exists())try{customBitmap=decode(customFile);}catch(Exception ignored){}
  if(bitmap!=null)return;
  try(java.io.InputStream input=context.getAssets().open("sakura-evening.png")){BitmapFactory.Options o=new BitmapFactory.Options();o.inSampleSize=2;o.inPreferredConfig=Bitmap.Config.RGB_565;bitmap=BitmapFactory.decodeStream(input,null,o);}catch(java.io.IOException ignored){}
 }
 static Bitmap decode(java.io.File file)throws java.io.IOException{
  BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getPath(),options);
  if(options.outWidth<16||options.outHeight<16)throw new java.io.IOException("Не удалось прочитать изображение");
  options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>1600)options.inSampleSize*=2;
  options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.RGB_565;Bitmap result=BitmapFactory.decodeFile(file.getPath(),options);if(result==null)throw new java.io.IOException("Не удалось прочитать изображение");
  try{int orientation=new android.media.ExifInterface(file.getPath()).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION,1);int rotation=orientation==6?90:orientation==3?180:orientation==8?270:0;if(rotation!=0){Matrix matrix=new Matrix();matrix.postRotate(rotation);Bitmap rotated=Bitmap.createBitmap(result,0,0,result.getWidth(),result.getHeight(),matrix,true);if(rotated!=result)result.recycle();result=rotated;}}catch(java.io.IOException ignored){}
  return result;
 }
 private void photo(Canvas canvas,RectF bounds,int alpha){
  Bitmap photo=custom&&customBitmap!=null?customBitmap:bitmap;if(photo==null)return;float ratio=bounds.width()/bounds.height(),image=photo.getWidth()/(float)photo.getHeight();int w=photo.getWidth(),h=photo.getHeight();
  if(image>ratio){int crop=Math.round(h*ratio),right=Math.round((w-crop)*.75f);source.set(right,0,right+crop,h);}else{int crop=Math.round(w/ratio);source.set(0,0,w,crop);}
  paint.setAlpha(alpha);canvas.drawBitmap(photo,source,bounds,paint);paint.setAlpha(255);
 }
 @Override public void draw(Canvas canvas){target.set(getBounds());photo(canvas,target,50);}
 @Override public void setAlpha(int alpha){}
 @Override public void setColorFilter(ColorFilter filter){}
 @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}
