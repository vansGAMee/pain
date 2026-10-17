package dev.mono.local;

import android.content.Context;
import android.graphics.*;
import android.os.SystemClock;
import android.view.*;
import java.util.function.*;

/** Tiny dynamic layer; no scene re-layout or shadow work on animation frames. */
public final class InstrumentView extends View {
  public String kind;
  public float progress;
  public boolean playing, animate, active;
  public long[] values = new long[0];
  public int ink = 0xff11110f, paper = 0xffefede6;
  private long anchor = SystemClock.elapsedRealtime(), duration;
  private float speed = 1;
  private boolean dragging;

  public void playback(float value, long length, boolean active, boolean motion, float rate) {
    if (!dragging) {
      progress = value;
      anchor = SystemClock.elapsedRealtime();
    }
    duration = length;
    playing = active;
    animate = motion;
    speed = rate;
    invalidate();
  }

  private float playBlend;
  private android.animation.ValueAnimator playTransition;

  public void setPlaying(boolean value) {
    playing = value;
    if (playTransition != null) playTransition.cancel();
    float target = value ? 1f : 0f;
    if (!isLaidOut() || !isAttachedToWindow() || !MicroMotion.enabled(this)) {
      playBlend = target;
      invalidate();
      return;
    }
    playTransition = android.animation.ValueAnimator.ofFloat(playBlend, target);
    playTransition.setDuration(150);
    playTransition.setInterpolator(MicroMotion.EASE);
    playTransition.addUpdateListener(a -> { playBlend = (float) a.getAnimatedValue(); invalidate(); });
    playTransition.start();
  }

  @Override protected void onDetachedFromWindow() {
    if (playTransition != null) playTransition.cancel();
    playBlend = playing ? 1f : 0f;
    super.onDetachedFromWindow();
  }

  public DoubleConsumer seek;
  public Runnable tap;
  private final Paint p = new Paint(3);
  private final Path triangle = new Path();
  private long origin = SystemClock.elapsedRealtime();

  public InstrumentView(Context c, String kind) {
    super(c);
    this.kind = kind;
    setFocusable(true);
  }

  @Override
  protected void onDraw(Canvas c) {
    super.onDraw(c);
    float w = getWidth(), h = getHeight();
    float position = progress;
    if (playing && animate && !dragging && duration > 0)
      position =
          Math.min(1, progress + (SystemClock.elapsedRealtime() - anchor) * speed / duration);
    p.setShader(null);
    p.setColor(ink);
    p.setStrokeWidth(Math.max(1, w / 100));
    p.setStyle(Paint.Style.FILL);
    switch (kind) {
      case "play":
        if (playBlend > 0) {
          p.setAlpha(Math.round(255 * playBlend));
          c.drawRoundRect(w * .32f, h * .23f, w * .43f, h * .77f, 2, 2, p);
          c.drawRoundRect(w * .57f, h * .23f, w * .68f, h * .77f, 2, 2, p);
        }
        if (playBlend < 1) {
          p.setAlpha(Math.round(255 * (1 - playBlend)));
          triangle.reset();
          triangle.moveTo(w * .36f, h * .22f);
          triangle.lineTo(w * .76f, h * .5f);
          triangle.lineTo(w * .36f, h * .78f);
          triangle.close();
          c.drawPath(triangle, p);
        }
        p.setAlpha(255);
        break;
      case "progress":
        p.setColor((ink & 0xffffff) | 0x33000000);
        c.drawRoundRect(0, h * .47f, w, h * .53f, 3, 3, p);
        p.setColor(ink);
        c.drawRoundRect(0, h * .47f, w * position, h * .53f, 3, 3, p);
        c.drawCircle(
            Math.max(h * .12f, Math.min(w - h * .12f, w * position)), h * .5f, h * .13f, p);
        break;
      case "dial":
        float r = Math.min(w, h) / 2 - 9;
        float a = (float) (position * Math.PI * 2 - Math.PI / 2);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1);
        p.setColor((ink & 0xffffff) | 0x55000000);
        c.drawCircle(w / 2, h / 2, r, p);
        p.setStyle(Paint.Style.FILL);
        p.setColor(ink);
        c.drawCircle(
            w / 2 + (float) Math.cos(a) * r,
            h / 2 + (float) Math.sin(a) * r,
            Math.max(4, w * .024f),
            p);
        if (animate && playing) {
          float angle = (SystemClock.elapsedRealtime() - origin) / 1000f * .08f;
          p.setColor((ink & 0xffffff) | 0x45000000);
          c.drawCircle(
              w / 2 + (float) Math.cos(angle) * r * .71f,
              h / 2 + (float) Math.sin(angle) * r * .71f,
              2,
              p);
          postInvalidateOnAnimation();
        }
        break;
      case "ratio":
        p.setColor((ink & 0xffffff) | 0x22000000);
        c.drawRoundRect(0, 0, w, h, 3, 3, p);
        p.setColor(ink);
        c.drawRoundRect(0, 0, w * progress, h, 3, 3, p);
        break;
      case "switch":
        p.setColor((ink & 0xffffff) | 0x33000000);
        c.drawRoundRect(0, 0, w, h, h / 2, h / 2, p);
        p.setColor(paper);
        c.drawCircle(h / 2, h / 2, h * .34f, p);
        break;
      case "repeat":
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(Math.max(1.6f, w * 0.075f));
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(active ? ink : ((ink & 0xffffff) | 0x44000000));
        float rx = w * 0.22f, ry = h * 0.26f, rw = w * 0.56f, rh = h * 0.48f;
        RectF loop = new RectF(rx, ry, rx + rw, ry + rh);
        c.drawRoundRect(loop, rw * 0.25f, rw * 0.25f, p);
        p.setStyle(Paint.Style.FILL);
        Path arr = new Path();
        float aSize = w * 0.12f;
        arr.moveTo(rx + rw * 0.65f, ry - aSize * 0.8f);
        arr.lineTo(rx + rw * 0.65f + aSize, ry);
        arr.lineTo(rx + rw * 0.65f, ry + aSize * 0.8f);
        arr.close();
        c.drawPath(arr, p);
        if (active) {
          p.setTextSize(w * 0.30f);
          p.setTypeface(DesignScene.font(getContext()));
          p.setTextAlign(Paint.Align.CENTER);
          c.drawText("1", w / 2, h / 2 + w * 0.10f, p);
        }
        break;
      case "heart":
        Path hp = new Path();
        float hcx = w / 2f, topY = h * 0.28f, botY = h * 0.76f;
        float hw = w * 0.31f, hh = h * 0.25f;
        hp.moveTo(hcx, topY + hh * 0.5f);
        hp.cubicTo(hcx - hw * 0.4f, topY - hh * 0.5f, hcx - hw, topY, hcx - hw, topY + hh);
        hp.cubicTo(hcx - hw, topY + hh * 1.5f, hcx - hw * 0.5f, botY - hh * 0.5f, hcx, botY);
        hp.cubicTo(hcx + hw * 0.5f, botY - hh * 0.5f, hcx + hw, topY + hh * 1.5f, hcx + hw, topY + hh);
        hp.cubicTo(hcx + hw, topY, hcx + hw * 0.4f, topY - hh * 0.5f, hcx, topY + hh * 0.5f);
        hp.close();
        if (active) {
          p.setStyle(Paint.Style.FILL);
          p.setColor(ink);
          c.drawPath(hp, p);
        } else {
          p.setStyle(Paint.Style.STROKE);
          p.setStrokeWidth(Math.max(1.6f, w * 0.075f));
          p.setStrokeCap(Paint.Cap.ROUND);
          p.setStrokeJoin(Paint.Join.ROUND);
          p.setColor((ink & 0xffffff) | 0x55000000);
          c.drawPath(hp, p);
        }
        break;
      case "bars":
        long max = 1;
        for (long n : values) max = Math.max(max, n);
        float gap = w / (Math.max(1, values.length) * 3);
        for (int i = 0; i < values.length; i++) {
          float bw = w / values.length - gap;
          float bh = Math.max(2, (h - 8) * values[i] / max);
          p.setColor(values[i] > 0 ? ink : (ink & 0xffffff) | 0x22000000);
          c.drawRoundRect(i * (bw + gap), h - bh, (i + 1) * bw + i * gap, h, 2, 2, p);
        }
        break;
      case "clock":
        float rad = Math.min(w, h) * .43f;
        long peak = 1;
        for (long v : values) peak = Math.max(peak, v);
        p.setStrokeWidth(2);
        for (int i = 0; i < 24; i++) {
          double angle = i / 24d * 2 * Math.PI - Math.PI / 2;
          float ratio = values.length > i ? (float) values[i] / peak : 0;
          float inner = rad - (5 + ratio * 12) * getResources().getDisplayMetrics().density;
          p.setColor(ratio > 0 ? ink : (ink & 0xffffff) | 0x33000000);
          c.drawLine(
              w / 2 + (float) Math.cos(angle) * inner,
              h / 2 + (float) Math.sin(angle) * inner,
              w / 2 + (float) Math.cos(angle) * rad,
              h / 2 + (float) Math.sin(angle) * rad,
              p);
        }
        break;
    }
    if (playing && animate && (kind.equals("progress") || kind.equals("dial")))
      postInvalidateOnAnimation();
  }

  @Override
  public boolean onTouchEvent(android.view.MotionEvent e) {
    if (seek == null) return super.onTouchEvent(e);
    if (e.getAction() == MotionEvent.ACTION_DOWN
        || e.getAction() == MotionEvent.ACTION_MOVE
        || e.getAction() == MotionEvent.ACTION_UP) {
      getParent().requestDisallowInterceptTouchEvent(true);
      dragging = true;
      float fraction;
      if (kind.equals("dial")) {
        double a =
            Math.atan2(e.getY() - getHeight() / 2f, e.getX() - getWidth() / 2f) + Math.PI / 2;
        if (a < 0) a += Math.PI * 2;
        fraction = (float) (a / (Math.PI * 2));
      } else fraction = e.getX() / getWidth();
      progress = Math.max(0, Math.min(1, fraction));
      invalidate();
      if (e.getAction() == MotionEvent.ACTION_UP) {
        dragging = false;
        anchor = SystemClock.elapsedRealtime();
        seek.accept(progress);
        performClick();
      }
      return true;
    }
    return true;
  }

  @Override
  public void onInitializeAccessibilityNodeInfo(
      android.view.accessibility.AccessibilityNodeInfo info) {
    super.onInitializeAccessibilityNodeInfo(info);
    if (seek != null) {
      info.setClassName(SeekBarClass());
      info.setRangeInfo(
          android.view.accessibility.AccessibilityNodeInfo.RangeInfo.obtain(
              android.view.accessibility.AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT,
              0,
              100,
              progress * 100));
      info.addAction(
          android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS);
      info.addAction(
          android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
              .ACTION_SCROLL_FORWARD);
      info.addAction(
          android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction
              .ACTION_SCROLL_BACKWARD);
    }
  }

  private String SeekBarClass() {
    return "android.widget.SeekBar";
  }

  @Override
  public boolean performAccessibilityAction(int action, android.os.Bundle args) {
    if (seek != null) {
      if (action == android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        progress = Math.min(1, progress + .05f);
      else if (action == android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
        progress = Math.max(0, progress - .05f);
      else if (action == android.R.id.accessibilityActionSetProgress && args != null)
        progress =
            Math.max(
                0,
                Math.min(
                    1,
                    args.getFloat(
                            android.view.accessibility.AccessibilityNodeInfo
                                .ACTION_ARGUMENT_PROGRESS_VALUE)
                        / 100));
      else return super.performAccessibilityAction(action, args);
      seek.accept(progress);
      invalidate();
      return true;
    }
    return super.performAccessibilityAction(action, args);
  }

  @Override
  public boolean performClick() {
    super.performClick();
    if (tap != null) tap.run();
    return true;
  }
}
