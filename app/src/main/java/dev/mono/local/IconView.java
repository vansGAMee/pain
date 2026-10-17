package dev.mono.local;
import android.content.Context;
import android.graphics.*;
import android.view.View;

/** One 24-unit icon grid shared by navigation, toolbars and playback controls. */
public final class IconView extends View {
  private final String name; private final int color; public boolean active;
  private final Paint p=new Paint(3); private final Path path=new Path();
  public IconView(Context c,String name,int color){super(c);this.name=name;this.color=color;}
  private void line(Canvas c,float x,float y,float a,float b){c.drawLine(x,y,a,b,p);}
  private void path(Canvas c,float... xy){path.reset();path.moveTo(xy[0],xy[1]);for(int i=2;i<xy.length;i+=2)path.lineTo(xy[i],xy[i+1]);c.drawPath(path,p);}
  protected void onDraw(Canvas c){
    float s=Math.min(getWidth(),getHeight())*(getWidth()>getResources().getDisplayMetrics().density*36?.48f:.82f)/24;
    c.save();c.translate((getWidth()-24*s)/2,(getHeight()-24*s)/2);c.scale(s,s);
    p.setColor(color);p.setStrokeWidth(1.8f);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);p.setStyle(Paint.Style.STROKE);
    switch(name){
      case "home":path(c,3,10,12,3,21,10);path(c,5,9,5,21,10,21,10,14,14,14,14,21,19,21,19,9);break;
      case "library":c.drawRoundRect(3,4,7,21,1,1,p);line(c,11,4,11,21);path(c,16,4,20,3,23,20,19,21,16,4);break;
      case "stats":line(c,4,20,4,13);line(c,12,20,12,4);line(c,20,20,20,8);break;
      case "device":c.drawRoundRect(6,2,18,22,3,3,p);line(c,10,18,14,18);break;
      case "search":c.drawCircle(10,10,6.5f,p);line(c,15,15,21,21);break;
      case "sort":line(c,3,5,15,5);line(c,3,11,12,11);line(c,3,17,9,17);path(c,16,16,19,20,22,16);line(c,19,4,19,20);break;
      case "settings":line(c,4,6,20,6);line(c,4,12,20,12);line(c,4,18,20,18);p.setStyle(Paint.Style.FILL);c.drawCircle(9,6,3,p);c.drawCircle(16,12,3,p);c.drawCircle(9,18,3,p);break;
      case "back":path(c,15,4,7,12,15,20);break;
      case "chevron":path(c,9,6,15,12,9,18);break;
      case "menu":for(int y=5;y<=19;y+=7){p.setStyle(Paint.Style.FILL);c.drawCircle(12,y,1.5f,p);}break;
      case "previous":p.setStyle(Paint.Style.FILL);path.reset();path.moveTo(18,5);path.lineTo(7,12);path.lineTo(18,19);path.close();c.drawPath(path,p);line(c,5,5,5,19);break;
      case "next":p.setStyle(Paint.Style.FILL);path.reset();path.moveTo(6,5);path.lineTo(17,12);path.lineTo(6,19);path.close();c.drawPath(path,p);line(c,19,5,19,19);break;
      case "repeat":path(c,18,3,21,6,18,9);path(c,21,6,6,6,3,9,3,12);path(c,6,21,3,18,6,15);path(c,3,18,18,18,21,15,21,12);if(active){p.setStyle(Paint.Style.FILL);c.drawCircle(12,12,2,p);}break;
      case "heart":path.reset();path.moveTo(12,21);path.cubicTo(9,18,2,13,2,8);path.cubicTo(2,1,10,1,12,6);path.cubicTo(14,1,22,1,22,8);path.cubicTo(22,13,15,18,12,21);if(active)p.setStyle(Paint.Style.FILL);c.drawPath(path,p);break;
    }
    c.restore();
  }
}
