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
	int clientfd=socket(AF_INET,SOCK_STREAM,0);
	struct sockaddr_in addr={0};
	addr.sin_family=AF_INET;
	addr.sin_addr.s_addr=inet_addr("127.0.0.1");
	addr.sin_port=htons(5000);
	char buffer[10000];
	int data_socket;
	char post_r[10000]=
		"POST / HTTP/1.1\r\n"
		"Host: 127.0.0.1:5000\r\n"
		"Content-Type: application/json\r\n"
		"\r\n";
	connect(clientfd,(struct sockaddr*)&addr,sizeof(addr));
	send(clientfd,post_r,strlen(post_r),0);
	int bytes;
	while((bytes=read(clientfd,buffer,sizeof(buffer)-1))>0){
		buffer[bytes]='\0';
		cout<<buffer;
	}
	cout<<"Server response :"<<endl<<buffer<<endl;
	close(clientfd);
	return 0;
}
