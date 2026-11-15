package dev.mono.local;

import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.widget.SeekBar;
import android.widget.Switch;

/** Moulded black controls. Shaders are rebuilt only when bounds/state change,
 * never on playback frames. Geometry and hit targets belong to the host view. */
final class CarbonSurface extends Drawable {
  static final ColorMatrixColorFilter MONOCHROME;
  static {
    ColorMatrix matrix = new ColorMatrix(); matrix.setSaturation(0);
    MONOCHROME = new ColorMatrixColorFilter(matrix);
  }
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final RectF rect = new RectF();
  private final float density, radius;
  private final boolean recessed;
  private Shader face, rim;
  private boolean pressed, focused;
  private int alpha = 255;

  CarbonSurface(Context context, float radius, boolean recessed) {
    density = context.getResources().getDisplayMetrics().density;
    this.radius = radius * density;
    this.recessed = recessed;
  }

  static boolean enabled(Context context) {
    return ((MonoApp) context.getApplicationContext()).prefs.getString("theme", "sakura").equals("carbon");
  }

  private static GradientDrawable rounded(Context context, int top, int bottom, int width, int height) {
    float d = context.getResources().getDisplayMetrics().density;
    GradientDrawable shape = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{top, bottom});
    shape.setCornerRadius(height * d / 2); shape.setSize(Math.round(width * d), Math.round(height * d));
    shape.setStroke(Math.max(1, Math.round(d)), 0xff555555);
    return shape;
  }

  private static Drawable thumb(Context context, int size) {
    int inset = Math.round(3 * context.getResources().getDisplayMetrics().density);
    LayerDrawable knob = new LayerDrawable(new Drawable[]{
        rounded(context, 0xff080808, 0xff303030, size, size),
        rounded(context, 0xffa5a5a5, 0xff444444, size - 6, size - 6)});
    knob.setLayerInset(1, inset, inset, inset, inset);
    return knob;
  }

  static void style(SeekBar control) {
    Context context = control.getContext();
    Drawable well = rounded(context, 0xff070707, 0xff202020, 120, 6);
    Drawable fill = new ClipDrawable(rounded(context, 0xffbcbcbc, 0xff777777, 120, 6), Gravity.LEFT, ClipDrawable.HORIZONTAL);
    LayerDrawable track = new LayerDrawable(new Drawable[]{well, fill});
    track.setId(0, android.R.id.background); track.setId(1, android.R.id.progress);
    control.setProgressTintList(null); control.setProgressBackgroundTintList(null); control.setThumbTintList(null);
    control.setProgressDrawable(track); control.setThumb(thumb(context, 24));
    control.setSplitTrack(false);
  }

  static void style(Switch control) {
    Context context = control.getContext();
    StateListDrawable track = new StateListDrawable();
    track.addState(new int[]{android.R.attr.state_checked}, rounded(context, 0xff161616, 0xff3b3b3b, 52, 28));
    track.addState(new int[]{}, rounded(context, 0xff070707, 0xff191919, 52, 28));
    control.setTrackTintList(null); control.setThumbTintList(null);
    control.setTrackDrawable(track); control.setThumbDrawable(thumb(context, 28));
    control.setSplitTrack(false);
  }

  @Override public boolean isStateful() { return true; }
  @Override protected boolean onStateChange(int[] states) {
    boolean down = false, focus = false;
    for (int state : states) {
      down |= state == android.R.attr.state_pressed || state == android.R.attr.state_selected;
      focus |= state == android.R.attr.state_focused;
    }
    if (pressed == down && focused == focus) return false;
    pressed = down; focused = focus; updateShaders(); invalidateSelf(); return true;
  }
  @Override protected void onBoundsChange(Rect bounds) { updateShaders(); }

  private void updateShaders() {
    Rect b = getBounds();
    boolean inset = recessed || pressed;
    face = new LinearGradient(b.left, b.top, b.right * .7f, b.bottom,
        inset ? new int[]{0xff090909, 0xff191919, 0xff222222}
            : new int[]{0xff414141, 0xff292929, 0xff191919},
        new float[]{0, .48f, 1}, Shader.TileMode.CLAMP);
    rim = new LinearGradient(b.left, b.top, b.right, b.bottom,
        inset ? new int[]{0xff080808, 0xff111111, 0xff494949}
            : new int[]{0xff666666, 0xff303030, 0xff080808},
        null, Shader.TileMode.CLAMP);
  }

  @Override public void draw(Canvas canvas) {
    if (face == null) updateShaders();
    rect.set(getBounds()); rect.inset(density, density);
    paint.setAlpha(alpha); paint.setStyle(Paint.Style.FILL); paint.setShader(null);
    paint.setColor(0xff080808);
    canvas.drawRoundRect(rect, radius, radius, paint);
    rect.inset(density, density); rect.bottom -= density;
    paint.setShader(face); canvas.drawRoundRect(rect, radius, radius, paint);
    paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(density);
    paint.setShader(focused ? null : rim);
    if (focused) paint.setColor(0xffeeeeee);
    canvas.drawRoundRect(rect, radius, radius, paint);
    paint.setShader(null); paint.setStyle(Paint.Style.FILL);
  }

  @Override public void setAlpha(int value) { alpha = value; invalidateSelf(); }
  @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
  @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}
