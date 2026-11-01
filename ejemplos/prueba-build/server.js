const http = require('node:http')

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('prueba-build funciona\n')
  })
  .listen(3000, () => console.log('Escuchando en el puerto 3000'))
