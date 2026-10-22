const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('periodic Windows discovery hides its shell and still probes parsed private addresses',()=>{
 const source=fs.readFileSync(require.resolve('../src/server'),'utf8');
 const start=source.indexOf('function scanArpTable()'),end=source.indexOf('// Check last known IP',start);
 const calls=[],probes=[];
 const context={process:{platform:'win32'},Set,Array,exec:(command,options,callback)=>{
  calls.push({command,options});callback(null,'192.168.1.42 192.168.1.42 192.168.1.1 192.168.1.255 10.0.0.2');
 },probeDevice:ip=>probes.push(ip),MOBILE_HTTP_PORT:8865};
 vm.runInNewContext(source.slice(start,end)+';scanArpTable();scanArpTable();',context);
 assert.equal(calls.length,2);for(const c of calls){assert.equal(c.command,'arp -a');assert.equal(c.options.windowsHide,true);assert.equal(c.options.timeout,2000);}
 assert.deepEqual(probes,['192.168.1.42','10.0.0.2','192.168.1.42','10.0.0.2']);
});
