#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>

#define PORT 9000
#define BUFFER 4096

int main() {

    int server_fd, client_fd;
    struct sockaddr_in server_addr, client_addr;
    socklen_t addr_len = sizeof(client_addr);

    char buffer[BUFFER];

    server_fd = socket(AF_INET, SOCK_STREAM, 0);

    if(server_fd < 0){
        perror("socket");
        return 1;
    }

    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(PORT);
    server_addr.sin_addr.s_addr = INADDR_ANY;

    bind(server_fd, (struct sockaddr*)&server_addr, sizeof(server_addr));

    listen(server_fd, 5);

    printf("Minimal MCP Server running on port %d\n", PORT);

    while(1){

        client_fd = accept(server_fd, (struct sockaddr*)&client_addr, &addr_len);

        printf("Client connected\n");

        int bytes = read(client_fd, buffer, BUFFER-1);

        if(bytes > 0){

            buffer[bytes] = '\0';

            printf("Received:\n%s\n", buffer);

            char response[BUFFER];

            if(strstr(buffer, "tools/list")){

                strcpy(response,
                "{"
                "\"jsonrpc\":\"2.0\","
                "\"result\":{"
                "\"tools\":["
                "{ \"name\":\"hello\", \"description\":\"hello tool\" }"
                "]"
                "}"
                "}\n");

            }else{

                strcpy(response,
                "{"
                "\"jsonrpc\":\"2.0\","
                "\"result\":\"unknown method\""
                "}\n");

            }

            write(client_fd, response, strlen(response));
        }

        close(client_fd);
    }

    close(server_fd);
}
