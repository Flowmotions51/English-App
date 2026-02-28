package com.englishapp.api;

import com.englishapp.service.CurrentUserService;
import com.englishapp.service.MindMapService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/lists")
public class MindMapController {
    private final CurrentUserService currentUserService;
    private final MindMapService mindMapService;

    public MindMapController(CurrentUserService currentUserService, MindMapService mindMapService) {
        this.currentUserService = currentUserService;
        this.mindMapService = mindMapService;
    }

    @GetMapping("/{listId}/mind-map")
    public Map<String, Object> getListMindMap(@PathVariable Long listId) {
        return mindMapService.listMindMap(currentUserService.getCurrentUserId(), listId);
    }
}
