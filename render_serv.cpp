#include<iostream>
#include<string>
#include<cstring>
#include<arpa/inet.h>
#include<sys/types.h>
#include<unistd.h>
#include<sys/socket.h>
#include<netinet/in.h>
#define port 4444
using namespace std;
int main(){
	int count=0;
	int serverfd=socket(AF_INET,SOCK_STREAM,0);
	FILE *fp=fopen("counter.html","r");
	char buffer[1000];
	int data_socket;
	char response[10000]=
		"HTTP/1.1 200 OK\r\n"
		"Server: myjacks/1.0\r\n"
		"Content-Type: text/html; charset=UTF-8\r\n"
		"Connection: close\r\n"
		"\r\n";
	while(fgets(buffer,sizeof(buffer),fp)!=NULL){
		strcat(response,buffer);
	}
	struct sockaddr_in addr={0};
	addr.sin_family=AF_INET;
	addr.sin_addr.s_addr=inet_addr("0.0.0.0");
	addr.sin_port=htons(port);
	bind(serverfd,(struct sockaddr*)&addr,sizeof(addr));
	listen(serverfd,5);
	cout<<"server is listening on port number :"<<port<<endl;
	while(1){
		data_socket=accept(serverfd,NULL,NULL);
		read(data_socket,buffer,sizeof(buffer));
		cout<<"client request :"<<count<<" "<<buffer<<endl;
		send(data_socket,response,strlen(response),0);
		close(data_socket);
		count++;
	}
	close(serverfd);
	return 0;
}
