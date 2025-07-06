# Structured Responses

## Overview

This current project is an "MCP" server that lets you query the "Searx-ng" search engine.
However, the current implementation just seems to return all the websites mashed together.

The objective of this project is to break that up into a JSON/XML document that
depicts the search results in a structured way.

## Example

```json
{
    "results": {
        "title": "Title of the search result",
        "url": "https://www.example.com",
        "content": "Content of the search result" // possibly summarized, limited to a few sentences
        "score": 0.0 // searx "relevance" score
        "category": "news" // searx "category"
    },
    "metadata": {
        "total_results": 100,
        "time_taken": 0.123,
        "query": "search query"
    }
}
```

So, basically, we add a new "command" to the MCP server that takes a search query and returns the above response (massaged if it has to be to meet the "MCP" standard).

Let's leave the existing "search" command as is, and add a new "search_structured" command that takes a search query and returns the above response (massaged if it has to be to meet the "MCP" standard). That way this is just an "additive" change.

OK, I think there's enough going with the existing code we can just figure out how to extend this and meet our objective.
